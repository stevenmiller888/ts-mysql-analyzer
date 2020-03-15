import { ValueReference } from 'ts-mysql-parser'
import { SchemaColumn } from 'ts-mysql-schema'

/** Checks if the value reference is correctly assigning null to a column */
export function validNullAssignment(valueRef: ValueReference, schemaColumn: SchemaColumn): boolean {
  return valueRef.dataType === 'null' && schemaColumn.optional
}
