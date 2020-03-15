# ts-mysql-analyzer

![Alt Text](https://github.com/stevenmiller888/ts-mysql-analyzer/workflows/CI/badge.svg)

> A MySQL query analyzer.

![Alt Text](https://github.com/stevenmiller888/ts-mysql-analyzer/raw/master/.github/code.png)

## Features

- Detects MySQL syntax errors
- Detects invalid table names/column names (powered by your schema)
- Type checking (powered by your schema)
- Optimization suggestions (e.g. query for column with missing index)
- Supports custom parser options (e.g. MySQL version, character sets, etc.)
- Supports multiple statements

## Installation

```shell
yarn add ts-mysql-analyzer
# or
npm install ts-mysql-analyzer
```

## Usage

```typescript
import { MySQLAnalyzer } from 'ts-mysql-analyzer'
import { MySQLSchema } from 'ts-mysql-schema'

const mySQLSchema = new MySQLSchema({
  uri: 'mysql://root@127.0.0.1:3310/test'
})

const analyzer = new MySQLAnalyzer({
  schema: await mySQLSchema.getSchema()
})

// "'SELT' is not valid at this position."
console.log(analyzer.analyze('SELT * FROM user'))

// "Table 'invalid_table' does not exist in database 'test'. Did you mean 'posts'?"
console.log(analyzer.analyze('SELECT * FROM invalid_table'))

// "Column 'invalid_column' does not exist in table 'users'. Did you mean 'name'?"
console.log(analyzer.analyze('SELECT invalid_column FROM users'))

// "Type boolean is not assignable to type string."
console.log(analyzer.analyze('SELECT * FROM users WHERE id = true'))

// "You can optimize this query by adding a MySQL index for column 'name'."
console.log(analyzer.analyze('SELECT * FROM users WHERE name = "some-name"'))
```

## Related

- [ts-mysql-parser](https://github.com/stevenmiller888/ts-mysql-parser) - A standalone, grammar-complete MySQL parser
- [ts-mysql-schema](https://github.com/stevenmiller888/ts-mysql-schema) - A schema extractor for MySQL
- [ts-mysql-uri](https://github.com/stevenmiller888/ts-mysql-uri) - Parse a MySQL connection URI
- [ts-antlr4-scanner](https://github.com/stevenmiller888/ts-antlr4-scanner) - A scanner for antlr4-based lexers

## License

[MIT](https://tldrlegal.com/license/mit-license)

---

> [stevenmiller888.github.io](https://stevenmiller888.github.io) &nbsp;&middot;&nbsp;
> GitHub [@stevenmiller888](https://github.com/stevenmiller888) &nbsp;&middot;&nbsp;
> Twitter [@stevenmiller888](https://twitter.com/stevenmiller888)
