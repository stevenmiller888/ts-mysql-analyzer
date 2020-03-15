import MySQLParser, {
  Statement,
  ParserOptions,
  MySQLQueryType,
  ReferenceType,
  TableReference,
  ColumnReference,
  ValueReference,
  ParseResult
} from 'ts-mysql-parser'
import { Schema, SchemaTable, SchemaColumn } from 'ts-mysql-schema'
import { validNullAssignment } from './lib/valid-null-assignment'
import { getCorrection } from './lib/autocorrect'

/** Represents a diagnostic uncovered during analysis */
export interface MySQLAnalyzerDiagnostic {
  readonly severity: DiagnosticSeverity
  /** Helpful message describing the diagnostic */
  readonly message: string
  /** The starting position of the diagnostic in the source text */
  readonly start: number
  /** The stopping position of the diagnostic in the source text */
  readonly stop: number
}

/** Represents the severity of the diagnostic */
export enum DiagnosticSeverity {
  /** Something suspicious but allowed */
  Warning,
  /** Something not allowed by any means */
  Error,
  /** Something to suggest a better way of doing things */
  Suggestion
}

/** Represents the options passed to the analyzer */
export interface MySQLAnalyzerOptions {
  /** The options passed to the underlying MySQL parser */
  readonly parserOptions?: ParserOptions
  /** The schema that represents the structure of a MySQL database */
  readonly schema?: Schema
}

export class MySQLAnalyzer {
  parserOptions?: ParserOptions
  schema?: Schema

  public constructor(options: MySQLAnalyzerOptions = {}) {
    this.parserOptions = options.parserOptions
    this.schema = options.schema
  }

  public analyze(text: string): MySQLAnalyzerDiagnostic[] {
    if (text === '') {
      return [
        {
          severity: DiagnosticSeverity.Error,
          message: 'MySQL query is empty.',
          start: 0,
          stop: text.length
        }
      ]
    }

    let diagnostics: MySQLAnalyzerDiagnostic[] = []

    const parser = new MySQLParser(this.parserOptions)
    const statements = parser.splitStatements(text)
    for (const statement of statements) {
      const result = parser.parse(statement.text)
      diagnostics = diagnostics.concat(this.analyzeSyntax(statement, result))
      diagnostics = diagnostics.concat(this.analyzeSemantics(statement, result, parser))
    }

    return diagnostics
  }

  private analyzeSyntax(statement: Statement, result: ParseResult): MySQLAnalyzerDiagnostic[] {
    const diagnostics: MySQLAnalyzerDiagnostic[] = []

    if (result.lexerError) {
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        message: result.lexerError.message,
        start: statement.start,
        stop: statement.stop
      })
    }

    if (result.parserError) {
      const { offendingToken } = result.parserError.data
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        message: result.parserError.message,
        start: statement.start + (offendingToken?.startIndex || 0),
        stop: statement.start + (offendingToken?.stopIndex || 0)
      })
    }

    return diagnostics
  }

  private analyzeSemantics(statement: Statement, result: ParseResult, parser: MySQLParser): MySQLAnalyzerDiagnostic[] {
    let diagnostics: MySQLAnalyzerDiagnostic[] = []

    if (parser.isDDL(result)) {
      return diagnostics
    }

    const columnRefs = result.references.filter(r => {
      return r.type === ReferenceType.ColumnRef
    }) as ColumnReference[]

    const valueRefs = result.references.filter(r => {
      return r.type === ReferenceType.ValueRef
    }) as ValueReference[]

    const queryType = parser.getQueryType(result)

    if (queryType === MySQLQueryType.QtInsert) {
      const fieldsClauseRefs = columnRefs.filter(r => r.context === 'fieldsClause')
      const valuesClauseValues = valueRefs.filter(r => r.context === 'valuesClause')

      if (fieldsClauseRefs.length !== valuesClauseValues.length) {
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          message: 'Column count does not match row count',
          start: statement.start,
          stop: statement.stop
        })
      }
    }

    if (!this.schema) {
      return diagnostics
    }

    const tableRefs = result.references.filter(r => {
      return r.type === ReferenceType.TableRef
    }) as TableReference[]

    diagnostics = diagnostics.concat(this.analyzeTables(statement, tableRefs, columnRefs, valueRefs))

    return diagnostics
  }

  private analyzeTables(
    statement: Statement,
    tableRefs: TableReference[],
    columnRefs: ColumnReference[],
    valueRefs: ValueReference[]
  ): MySQLAnalyzerDiagnostic[] {
    let diagnostics: MySQLAnalyzerDiagnostic[] = []

    const databaseName = this.schema?.config.schema

    for (const tableRef of tableRefs) {
      const { table, start, stop } = tableRef

      const schemaTable = this.schema?.tables.find(t => t.name === table)
      if (!schemaTable) {
        const messageParts = [`Table '${table}' does not exist in database '${databaseName}'.`]

        const tableNames = this.schema?.tables.map(t => t.name) || []
        const correction = getCorrection(table.toLowerCase(), tableNames)
        if (correction) {
          messageParts.push(` Did you mean '${correction}'?`)
        }

        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          message: messageParts.join(''),
          start: statement.start + start,
          stop: statement.start + stop
        })

        continue
      }

      const values = valueRefs.filter(r => r.columnReference?.tableReference?.table === table)
      const columns = columnRefs.filter(c => c.tableReference?.table === table)

      diagnostics = diagnostics.concat(this.analyzeColumns(statement, schemaTable, columns, values))
    }

    return diagnostics
  }

  private analyzeColumns(
    statement: Statement,
    schemaTable: SchemaTable,
    columnRefs: ColumnReference[],
    valueRefs: ValueReference[]
  ): MySQLAnalyzerDiagnostic[] {
    let diagnostics: MySQLAnalyzerDiagnostic[] = []

    const { name: tableName } = schemaTable

    for (const columnRef of columnRefs) {
      const { column, start, stop } = columnRef

      const schemaColumn = schemaTable.columns.find(c => c.name === column)
      if (!schemaColumn) {
        const messageParts = [`Column '${column}' does not exist in table '${tableName}'.`]

        const columnNames = schemaTable.columns.map(c => c.name)
        const correction = getCorrection(column.toLowerCase(), columnNames)
        if (correction) {
          messageParts.push(` Did you mean '${correction}'?`)
        }

        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          message: messageParts.join(''),
          start: statement.start + start,
          stop: statement.start + stop
        })

        continue
      }

      const valueRef = valueRefs.find(r => r.columnReference?.column === column)

      diagnostics = diagnostics.concat(this.analyzeColumn(statement, schemaColumn, columnRef, valueRef))
    }

    return diagnostics
  }

  private analyzeColumn(
    statement: Statement,
    schemaColumn: SchemaColumn,
    columnRef: ColumnReference,
    valueRef?: ValueReference
  ): MySQLAnalyzerDiagnostic[] {
    const diagnostics: MySQLAnalyzerDiagnostic[] = []

    if (!valueRef) {
      return diagnostics
    }

    if (!validNullAssignment(valueRef, schemaColumn) && valueRef.dataType !== schemaColumn.tsType) {
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        message: `Type ${valueRef.dataType} is not assignable to type ${schemaColumn.tsType}.`,
        start: statement.start + valueRef.start,
        stop: statement.start + valueRef.stop
      })
    }

    if (valueRef.context === 'whereClause' && schemaColumn.index === null) {
      diagnostics.push({
        severity: DiagnosticSeverity.Suggestion,
        message: `You can optimize this query by adding a MySQL index for column '${schemaColumn.name}'.`,
        start: statement.start + columnRef.start,
        stop: statement.start + columnRef.stop
      })
    }

    return diagnostics
  }
}
