import { SchemaColumn, TsDataType } from 'ts-mysql-schema'
import { ValueReference } from 'ts-mysql-parser'

export function invalidAssignment(schemaColumn: SchemaColumn, valueRef: ValueReference): boolean {
  if (valueRef.dataType === 'null' && schemaColumn.optional) {
    return false
  }

  if (schemaColumn.tsType === TsDataType.DATE) {
    const invalidAssignment = valueRef.dataType !== 'date' && valueRef.dataType !== 'string'
    const invalidDateString = valueRef.dataType === 'string' && isNaN(new Date(valueRef.value).getTime())
    return invalidAssignment || invalidDateString
  }

  return valueRef.dataType !== schemaColumn.tsType
}
