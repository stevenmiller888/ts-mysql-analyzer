import { SchemaColumn, SqlDataType } from 'ts-mysql-schema'
import { ValueReference } from 'ts-mysql-parser'

export function missingIndex(schemaColumn: SchemaColumn, valueRef: ValueReference): boolean {
  if (schemaColumn.sqlType === SqlDataType.JSON) {
    return false
  }

  return valueRef.context === 'whereClause' && schemaColumn.index === null
}
