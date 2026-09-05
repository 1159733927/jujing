import assert from 'node:assert/strict'
import test from 'node:test'
import { importCoordinateRecords, parseCoordinateInput } from '../src/coordinate-import.ts'

const administrative = [
  { code: '330106', name: '西湖区', provinceName: '浙江省', cityName: '杭州市' },
  { code: '360103', name: '西湖区', provinceName: '江西省', cityName: '南昌市' },
  { code: '330109', name: '萧山区', provinceName: '浙江省', cityName: '杭州市' },
]
const source = {
  id: 'licensed-fixture',
  label: 'Licensed fixture',
  version: '1',
  license: 'CC0-1.0',
  inputFile: 'fixture.csv',
  inputSha256: 'a'.repeat(64),
}

test('parses quoted project CSV and matches code before name', () => {
  const input = parseCoordinateInput('administrativeCode,name,longitude,latitude\n330106,"西湖区",120.1,30.2\n', 'csv')
  const report = importCoordinateRecords(input, administrative, { datasetVersion: '2026.08.1', source })
  assert.equal(report.summary.outputCount, 1)
  assert.equal(report.records[0].administrativeCode, '330106')
  assert.equal(report.records[0].matchMethod, 'administrative-code')
  assert.equal(report.records[0].source.license, 'CC0-1.0')
})

test('uses parent context for duplicate names and reports ambiguity without it', () => {
  const input = parseCoordinateInput(JSON.stringify([
    { name: '西湖区', provinceName: '浙江省', cityName: '杭州市', longitude: 120.1, latitude: 30.2 },
    { name: '西湖区', longitude: 115.9, latitude: 28.6 },
  ]), 'json')
  const report = importCoordinateRecords(input, administrative, { datasetVersion: '2026.08.1', source })
  assert.equal(report.records[0].administrativeCode, '330106')
  assert.equal(report.conflicts[0].reason, 'ambiguous-name')
  assert.deepEqual(report.conflicts[0].candidateCodes, ['330106', '360103'])
})

test('treats an exact code as authoritative and never invents invalid coordinates', () => {
  const input = parseCoordinateInput(JSON.stringify([
    { administrativeCode: '330106', name: '萧山区', longitude: 120.2, latitude: 30.1 },
    { administrativeCode: '330109', name: '萧山区', longitude: '', latitude: 30.1 },
  ]), 'json')
  const report = importCoordinateRecords(input, administrative, { datasetVersion: '2026.08.1', source })
  assert.equal(report.records.length, 1)
  assert.equal(report.records[0].administrativeCode, '330106')
  assert.equal(report.rejected[0].reason, 'invalid-longitude')
})

test('suppresses output when duplicate source rows disagree on coordinates', () => {
  const input = parseCoordinateInput('name,province,city,longitude,latitude\n萧山区,浙江省,杭州市,120.1,30.1\n萧山区,浙江省,杭州市,120.2,30.2\n', 'csv')
  const report = importCoordinateRecords(input, administrative, { datasetVersion: '2026.08.1', source })
  assert.equal(report.records.length, 0)
  assert.equal(report.conflicts.filter((item) => item.reason === 'duplicate-coordinate-disagreement').length, 2)
})

test('does not fall back to name matching when a malformed code is supplied', () => {
  const input = parseCoordinateInput(JSON.stringify([
    { administrativeCode: '33010', name: '西湖区', provinceName: '浙江省', longitude: 120.1, latitude: 30.2 },
  ]), 'json')
  const report = importCoordinateRecords(input, administrative, { datasetVersion: '2026.08.1', source })
  assert.equal(report.records.length, 0)
  assert.equal(report.conflicts[0].reason, 'administrative-code-not-found')
})
