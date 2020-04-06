import { MySQLAnalyzer, DiagnosticSeverity, DiagnosticCode } from '../'
import { MySQLSchema, Schema } from 'ts-mysql-schema'

let schema: Schema

beforeAll(async () => {
  const mySQLSchema = new MySQLSchema({
    uri: 'mysql://root@127.0.0.1:3310/test'
  })
  schema = await mySQLSchema.getSchema()
})

describe('MySQLAnalyzer', () => {
  it('returns diagnostic for empty queries', () => {
    const analyzer = new MySQLAnalyzer()
    const diagnostic = analyzer.analyze('')
    expect(diagnostic).toMatchObject([
      {
        severity: DiagnosticSeverity.Error,
        message: 'MySQL query is empty.',
        start: 0,
        stop: 0,
        code: DiagnosticCode.EmptyQuery
      }
    ])
  })

  it('returns diagnostic for lexer errors', () => {
    const analyzer = new MySQLAnalyzer()
    const diagnostic = analyzer.analyze('"')
    expect(diagnostic).toMatchObject([
      {
        severity: DiagnosticSeverity.Error,
        message: 'Unfinished double quoted string literal',
        start: 0,
        stop: 1,
        code: DiagnosticCode.LexerError
      }
    ])
  })

  it('returns diagnostic for parser errors', () => {
    const analyzer = new MySQLAnalyzer()
    const diagnostic = analyzer.analyze('SELE')
    expect(diagnostic).toMatchObject([
      {
        severity: DiagnosticSeverity.Error,
        message: `Extraneous input "SELE" found, expecting EOF, BEGIN, CACHE, CHECKSUM, COMMIT`,
        start: 0,
        stop: 3,
        code: DiagnosticCode.ParserError
      }
    ])
  })

  it('returns no diagnostics for valid query', () => {
    const analyzer = new MySQLAnalyzer()
    const diagnostics = analyzer.analyze('SELECT * FROM users')
    expect(diagnostics).toMatchObject([])
  })

  it('returns diagnostic for INSERT statements when column count != row count', () => {
    const analyzer = new MySQLAnalyzer()
    const diagnostic = analyzer.analyze('INSERT INTO users (id, status) VALUES ("1")')
    expect(diagnostic).toMatchObject([
      {
        severity: DiagnosticSeverity.Warning,
        message: 'Column count does not match row count.',
        start: 0,
        stop: 43,
        code: DiagnosticCode.ColumnRowMismatch
      }
    ])
  })

  it('returns diagnostic for 1 invalid table', () => {
    const analyzer = new MySQLAnalyzer({ schema })
    const diagnostic = analyzer.analyze('SELECT * FROM invalid_table')
    expect(diagnostic).toMatchObject([
      {
        severity: DiagnosticSeverity.Warning,
        message: "Table 'invalid_table' does not exist in database 'test'. Did you mean 'posts'?",
        start: 14,
        stop: 26,
        code: DiagnosticCode.MissingTable
      }
    ])
  })

  it('returns multiple diagnostics for multiple invalid tables', () => {
    const analyzer = new MySQLAnalyzer({ schema })
    const diagnostic = analyzer.analyze('SELECT * FROM invalid_table1 INNER JOIN invalid_table2')
    expect(diagnostic).toMatchObject([
      {
        severity: DiagnosticSeverity.Warning,
        message: "Table 'invalid_table1' does not exist in database 'test'. Did you mean 'posts'?",
        start: 14,
        stop: 27,
        code: DiagnosticCode.MissingTable
      },
      {
        severity: DiagnosticSeverity.Warning,
        message: "Table 'invalid_table2' does not exist in database 'test'. Did you mean 'posts'?",
        start: 40,
        stop: 53,
        code: DiagnosticCode.MissingTable
      }
    ])
  })

  it('returns diagnostic for 1 invalid column', () => {
    const analyzer = new MySQLAnalyzer({ schema })
    const diagnostic = analyzer.analyze('SELECT invalid_column FROM users')
    expect(diagnostic).toMatchObject([
      {
        severity: DiagnosticSeverity.Warning,
        message: "Column 'invalid_column' does not exist in table 'users'. Did you mean 'name'?",
        start: 7,
        stop: 20,
        code: DiagnosticCode.MissingColumn
      }
    ])
  })

  it('returns multiple diagnostics for multiple invalid columns', () => {
    const analyzer = new MySQLAnalyzer({ schema })
    const diagnostic = analyzer.analyze('SELECT invalid_column1, invalid_column2 FROM users')
    expect(diagnostic).toMatchObject([
      {
        severity: DiagnosticSeverity.Warning,
        message: "Column 'invalid_column1' does not exist in table 'users'. Did you mean 'name'?",
        start: 7,
        stop: 21,
        code: DiagnosticCode.MissingColumn
      },
      {
        severity: DiagnosticSeverity.Warning,
        message: "Column 'invalid_column2' does not exist in table 'users'. Did you mean 'name'?",
        start: 24,
        stop: 38,
        code: DiagnosticCode.MissingColumn
      }
    ])
  })

  it('returns diagnostic for 1 column in WHERE clause with missing index', () => {
    const analyzer = new MySQLAnalyzer({ schema })
    const diagnostic = analyzer.analyze('SELECT * FROM users WHERE name = "some-string"')
    expect(diagnostic).toMatchObject([
      {
        severity: DiagnosticSeverity.Suggestion,
        message: `You can optimize this query by adding a MySQL index for column 'name'.`,
        start: 26,
        stop: 29,
        code: DiagnosticCode.MissingIndex
      }
    ])
  })

  it('returns multiple diagnostics for multiple columns in WHERE clause with missing indices', () => {
    const analyzer = new MySQLAnalyzer({ schema })
    const diagnostic = analyzer.analyze('SELECT * FROM users WHERE name = "some-string" AND email="some-other-string"')
    expect(diagnostic).toMatchObject([
      {
        severity: DiagnosticSeverity.Suggestion,
        message: `You can optimize this query by adding a MySQL index for column 'name'.`,
        start: 26,
        stop: 29,
        code: DiagnosticCode.MissingIndex
      },
      {
        severity: DiagnosticSeverity.Suggestion,
        message: `You can optimize this query by adding a MySQL index for column 'email'.`,
        start: 51,
        stop: 55,
        code: DiagnosticCode.MissingIndex
      }
    ])
  })

  it('returns multiple diagnostics for multiple invalid assignments', () => {
    const analyzer = new MySQLAnalyzer({ schema })
    const diagnostic = analyzer.analyze('SELECT * FROM users WHERE id = true AND friends = "some-string"')
    expect(diagnostic).toMatchObject([
      {
        severity: DiagnosticSeverity.Warning,
        message: 'Type boolean is not assignable to type string.',
        start: 31,
        stop: 34,
        code: DiagnosticCode.TypeMismatch
      },
      {
        severity: DiagnosticSeverity.Warning,
        message: 'Type string is not assignable to type number.',
        start: 50,
        stop: 62,
        code: DiagnosticCode.TypeMismatch
      }
    ])
  })

  describe('string assignments', () => {
    it('string not assignable to number', () => {
      const analyzer = new MySQLAnalyzer({ schema })
      const diagnostic = analyzer.analyze('SELECT * FROM users WHERE friends = "some-string"')
      expect(diagnostic).toMatchObject([
        {
          severity: DiagnosticSeverity.Warning,
          message: 'Type string is not assignable to type number.',
          start: 36,
          stop: 48,
          code: DiagnosticCode.TypeMismatch
        }
      ])
    })

    it('string not assignable to boolean', () => {
      const analyzer = new MySQLAnalyzer({ schema })
      const diagnostic = analyzer.analyze('SELECT * FROM users WHERE enabled = "some-string"')
      expect(diagnostic).toMatchObject([
        {
          severity: DiagnosticSeverity.Warning,
          message: 'Type string is not assignable to type boolean.',
          start: 36,
          stop: 48,
          code: DiagnosticCode.TypeMismatch
        }
      ])
    })

    it('invalid date string not assignable to date', () => {
      const analyzer = new MySQLAnalyzer({ schema })
      const diagnostic = analyzer.analyze('SELECT * FROM users WHERE created = "some-string"')
      expect(diagnostic).toMatchObject([
        {
          severity: DiagnosticSeverity.Warning,
          message: 'Type string is not assignable to type date.',
          start: 36,
          stop: 48,
          code: DiagnosticCode.TypeMismatch
        }
      ])
    })

    it('valid date string assignable to date', () => {
      const analyzer = new MySQLAnalyzer({ schema })
      const diagnostic = analyzer.analyze('SELECT * FROM users WHERE created = "2020-04-06T14:28:25.774Z"')
      expect(diagnostic).toMatchObject([])
    })

    it('valid string assignment', () => {
      const analyzer = new MySQLAnalyzer({ schema })
      const diagnostic = analyzer.analyze('SELECT * FROM users WHERE id = "some-string"')
      expect(diagnostic).toMatchObject([])
    })
  })

  describe('number assignments', () => {
    it('number not assignable to string', () => {
      const analyzer = new MySQLAnalyzer({ schema })
      const diagnostic = analyzer.analyze('SELECT * FROM users WHERE id = 1')
      expect(diagnostic).toMatchObject([
        {
          severity: DiagnosticSeverity.Warning,
          message: 'Type number is not assignable to type string.',
          start: 31,
          stop: 31,
          code: DiagnosticCode.TypeMismatch
        }
      ])
    })

    it('number not assignable to boolean', () => {
      const analyzer = new MySQLAnalyzer({ schema })
      const diagnostic = analyzer.analyze('SELECT * FROM users WHERE enabled = 1')
      expect(diagnostic).toMatchObject([
        {
          severity: DiagnosticSeverity.Warning,
          message: 'Type number is not assignable to type boolean.',
          start: 36,
          stop: 36,
          code: DiagnosticCode.TypeMismatch
        }
      ])
    })

    it('number not assignable to date', () => {
      const analyzer = new MySQLAnalyzer({ schema })
      const diagnostic = analyzer.analyze('SELECT * FROM users WHERE created = 1')
      expect(diagnostic).toMatchObject([
        {
          severity: DiagnosticSeverity.Warning,
          message: 'Type number is not assignable to type date.',
          start: 36,
          stop: 36,
          code: DiagnosticCode.TypeMismatch
        }
      ])
    })

    it('valid number assignment', () => {
      const analyzer = new MySQLAnalyzer({ schema })
      const diagnostic = analyzer.analyze('SELECT * FROM users WHERE friends = 1')
      expect(diagnostic).toMatchObject([])
    })
  })

  describe('boolean assignments', () => {
    it('boolean not assignable to string', () => {
      const analyzer = new MySQLAnalyzer({ schema })
      const diagnostic = analyzer.analyze('SELECT * FROM users WHERE id = true')
      expect(diagnostic).toMatchObject([
        {
          severity: DiagnosticSeverity.Warning,
          message: 'Type boolean is not assignable to type string.',
          start: 31,
          stop: 34,
          code: DiagnosticCode.TypeMismatch
        }
      ])
    })

    it('boolean not assignable to number', () => {
      const analyzer = new MySQLAnalyzer({ schema })
      const diagnostic = analyzer.analyze('SELECT * FROM users WHERE friends = true')
      expect(diagnostic).toMatchObject([
        {
          severity: DiagnosticSeverity.Warning,
          message: 'Type boolean is not assignable to type number.',
          start: 36,
          stop: 39,
          code: DiagnosticCode.TypeMismatch
        }
      ])
    })

    it('boolean not assignable to date', () => {
      const analyzer = new MySQLAnalyzer({ schema })
      const diagnostic = analyzer.analyze('SELECT * FROM users WHERE created = true')
      expect(diagnostic).toMatchObject([
        {
          severity: DiagnosticSeverity.Warning,
          message: 'Type boolean is not assignable to type date.',
          start: 36,
          stop: 39,
          code: DiagnosticCode.TypeMismatch
        }
      ])
    })

    it('valid boolean assignment', () => {
      const analyzer = new MySQLAnalyzer({ schema })
      const diagnostic = analyzer.analyze('SELECT * FROM users WHERE enabled = true')
      expect(diagnostic).toMatchObject([])
    })
  })

  describe('null assignments', () => {
    it('null not assignable to string', () => {
      const analyzer = new MySQLAnalyzer({ schema })
      const diagnostic = analyzer.analyze('SELECT * FROM users WHERE id = null')
      expect(diagnostic).toMatchObject([
        {
          severity: DiagnosticSeverity.Warning,
          message: 'Type null is not assignable to type string.',
          start: 31,
          stop: 34,
          code: DiagnosticCode.TypeMismatch
        }
      ])
    })

    it('null not assignable to number', () => {
      const analyzer = new MySQLAnalyzer({ schema })
      const diagnostic = analyzer.analyze('SELECT * FROM users WHERE friends = null')
      expect(diagnostic).toMatchObject([
        {
          severity: DiagnosticSeverity.Warning,
          message: 'Type null is not assignable to type number.',
          start: 36,
          stop: 39,
          code: DiagnosticCode.TypeMismatch
        }
      ])
    })

    it('null not assignable to boolean', () => {
      const analyzer = new MySQLAnalyzer({ schema })
      const diagnostic = analyzer.analyze('SELECT * FROM users WHERE enabled = null')
      expect(diagnostic).toMatchObject([
        {
          severity: DiagnosticSeverity.Warning,
          message: 'Type null is not assignable to type boolean.',
          start: 36,
          stop: 39,
          code: DiagnosticCode.TypeMismatch
        }
      ])
    })

    it('null not assignable to date', () => {
      const analyzer = new MySQLAnalyzer({ schema })
      const diagnostic = analyzer.analyze('SELECT * FROM users WHERE created = null')
      expect(diagnostic).toMatchObject([
        {
          severity: DiagnosticSeverity.Warning,
          message: 'Type null is not assignable to type date.',
          start: 36,
          stop: 39,
          code: DiagnosticCode.TypeMismatch
        }
      ])
    })

    it('valid null assignment', () => {
      const analyzer = new MySQLAnalyzer({ schema })
      const diagnostic = analyzer.analyze('SELECT * FROM users WHERE project = null')
      expect(diagnostic).toMatchObject([])
    })
  })
})
