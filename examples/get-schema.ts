import { MySQLSchema, Schema } from 'ts-mysql-schema'

export async function getSchema(): Promise<Schema> {
  const mySQLSchema = new MySQLSchema({
    uri: 'mysql://root@127.0.0.1:3310/test'
  })
  return mySQLSchema.getSchema()
}
