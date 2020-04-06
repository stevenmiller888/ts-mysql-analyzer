import { SchemaColumns, SchemaColumn } from 'ts-mysql-schema'
import { AliasReference } from 'ts-mysql-parser'

export function getSchemaColumn(
  columnName: string,
  schemaColumns: SchemaColumns,
  aliasRefs: AliasReference[]
): SchemaColumn | null {
  const schemaColumn = schemaColumns.find(c => c.name === columnName)
  if (schemaColumn) {
    return schemaColumn
  }

  const columnAlias = aliasRefs.find(r => r.alias === columnName)
  if (columnAlias) {
    const schemaColumn = schemaColumns.find(c => c.name === columnAlias.columnReference?.column)
    if (schemaColumn) {
      return schemaColumn
    }
  }

  return null
}
