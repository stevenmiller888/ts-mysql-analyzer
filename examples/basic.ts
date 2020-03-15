import { MySQLAnalyzer } from '../src'

const analyzer = new MySQLAnalyzer()

const diagnostics = analyzer.analyze('SELT * FROM users')
console.log(diagnostics)
