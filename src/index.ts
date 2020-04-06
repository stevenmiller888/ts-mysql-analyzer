import MySQLParser, {
  Statement,
  ParserOptions,
  MySQLQueryType,
  ColumnReference,
  ValueReference,
  ParseResult,
  References,
  AliasReference
} from 'ts-mysql-parser'
import { Schema, SchemaTable, SchemaColumn } from 'ts-mysql-schema'
import { invalidAssignment } from './lib/invalid-assignment'
import { getSchemaColumn } from './lib/get-schema-column'
import { getSchemaTable } from './lib/get-schema-table'
import { missingIndex } from './lib/missing-index'
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
  /** The unique diagnostic code */
  readonly code: number
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

/** Represents the code of the diagnostic */
export enum DiagnosticCode {
  /** An empty MySQL query */
  EmptyQuery = 1000,
  /** A query that contains a lexer error */
  LexerError = 1001,
  /** A query that contains a parser error */
  ParserError = 1002,
  /** A mismatch in the number of rows and columns in an INSERT statement */
  ColumnRowMismatch = 1003,
  /** A table reference that does not exist in the schema */
  MissingTable = 1004,
  /** A column reference that does not exist in the referenced table in the schema */
  MissingColumn = 1005,
  /** An invalid type assignment */
  TypeMismatch = 1006,
  /** A missing database index for a referenced column */
  MissingIndex = 1007
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
          stop: text.length,
          code: DiagnosticCode.EmptyQuery
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
        stop: statement.stop,
        code: DiagnosticCode.LexerError
      })
    }

    if (result.parserError) {
      const { offendingToken } = result.parserError.data
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        message: result.parserError.message,
        start: statement.start + (offendingToken?.startIndex || 0),
        stop: statement.start + (offendingToken?.stopIndex || 0),
        code: DiagnosticCode.ParserError
      })
    }

    return diagnostics
  }

  private analyzeSemantics(statement: Statement, result: ParseResult, parser: MySQLParser): MySQLAnalyzerDiagnostic[] {
    let diagnostics: MySQLAnalyzerDiagnostic[] = []

    if (parser.isDDL(result)) {
      return diagnostics
    }

    if (parser.getQueryType(result) === MySQLQueryType.QtInsert) {
      const { columnReferences, valueReferences } = result.references
      const fieldsClauseRefs = columnReferences.filter(r => r.context === 'fieldsClause')
      const valuesClauseValues = valueReferences.filter(r => r.context === 'valuesClause')

      if (fieldsClauseRefs.length !== valuesClauseValues.length) {
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          message: 'Column count does not match row count.',
          start: statement.start,
          stop: statement.stop,
          code: DiagnosticCode.ColumnRowMismatch
        })
      }
    }

    if (!this.schema) {
      return diagnostics
    }

    const tableDiagnostics = this.analyzeTables(statement, result.references)
    diagnostics = diagnostics.concat(tableDiagnostics)

    return diagnostics
  }

  private analyzeTables(statement: Statement, references: References): MySQLAnalyzerDiagnostic[] {
    let diagnostics: MySQLAnalyzerDiagnostic[] = []

    if (!this.schema) {
      return diagnostics
    }

    const databaseName = this.schema?.config.schema
    const { tableReferences, columnReferences, valueReferences, aliasReferences } = references

    for (const tableRef of tableReferences) {
      const { table, start, stop } = tableRef

      const schemaTable = getSchemaTable(table, this.schema.tables, aliasReferences)
      if (schemaTable) {
        const columnRefs = columnReferences.filter(r => r.tableReference?.table === table)
        const valueRefs = valueReferences.filter(r => r.columnReference?.tableReference?.table === table)
        const columnDiagnostics = this.analyzeColumns(statement, schemaTable, columnRefs, valueRefs, aliasReferences)
        diagnostics = diagnostics.concat(columnDiagnostics)
      } else {
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
          stop: statement.start + stop,
          code: DiagnosticCode.MissingTable
        })
      }
    }

    return diagnostics
  }

  private analyzeColumns(
    statement: Statement,
    schemaTable: SchemaTable,
    columnRefs: ColumnReference[],
    valueRefs: ValueReference[],
    aliasRefs: AliasReference[]
  ): MySQLAnalyzerDiagnostic[] {
    let diagnostics: MySQLAnalyzerDiagnostic[] = []

    const { name: tableName } = schemaTable

    for (const columnRef of columnRefs) {
      const { column, start, stop } = columnRef

      const schemaColumn = getSchemaColumn(column, schemaTable.columns, aliasRefs)
      if (schemaColumn) {
        const valueRef = valueRefs.find(r => r.columnReference?.column === column)
        const columnDiagnostics = this.analyzeColumn(statement, schemaColumn, columnRef, valueRef)
        diagnostics = diagnostics.concat(columnDiagnostics)
      } else {
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
          stop: statement.start + stop,
          code: DiagnosticCode.MissingColumn
        })
      }
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

    if (invalidAssignment(schemaColumn, valueRef)) {
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        message: `Type ${valueRef.dataType} is not assignable to type ${schemaColumn.tsType}.`,
        start: statement.start + valueRef.start,
        stop: statement.start + valueRef.stop,
        code: DiagnosticCode.TypeMismatch
      })
    }

    if (missingIndex(schemaColumn, valueRef)) {
      diagnostics.push({
        severity: DiagnosticSeverity.Suggestion,
        message: `You can optimize this query by adding a MySQL index for column '${schemaColumn.name}'.`,
        start: statement.start + columnRef.start,
        stop: statement.start + columnRef.stop,
        code: DiagnosticCode.MissingIndex
      })
    }

    return diagnostics
  }
}
