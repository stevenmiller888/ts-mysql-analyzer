import { SchemaTable, SchemaTables } from 'ts-mysql-schema'
import { AliasReference } from 'ts-mysql-parser'

export function getSchemaTable(
  tableName: string,
  tables: SchemaTables,
  aliasRefs: AliasReference[]
): SchemaTable | null {
  const schemaTable = tables.find(t => t.name === tableName)
  if (schemaTable) {
    return schemaTable
  }

  const tableAlias = aliasRefs.find(r => r.alias === tableName)
  if (tableAlias) {
    const schemaTable = tables.find(t => t.name === tableAlias.tableReference?.table)
    if (schemaTable) {
      return schemaTable
    }
  }

  return null
}
