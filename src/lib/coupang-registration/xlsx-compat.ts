import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { XMLBuilder, XMLParser } from 'fast-xml-parser'

const SPREADSHEET_NAMESPACE = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const xmlOptions = {
  preserveOrder: true,
  ignoreAttributes: false,
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: false,
  commentPropName: '#comment',
  cdataPropName: '#cdata',
}
type XmlNode = { ':@'?: Record<string, string>; [name: string]: unknown }

/** ExcelJS matches literal tag names instead of resolving SpreadsheetML namespaces. */
export function compatibleSpreadsheetXml(xml: string): string {
  if (!xml.includes(SPREADSHEET_NAMESPACE)) return xml
  let changed = false
  function rewrite(nodes: XmlNode[], inherited: Map<string, string>, emittedDefault: string): XmlNode[] {
    return nodes.map((node) => {
      const name = Object.keys(node).find((key) => key !== ':@')
      if (!name || /^[#?!]/.test(name) || !Array.isArray(node[name])) return node
      const attributes = { ...node[':@'] }
      const namespaces = new Map(inherited)
      for (const [key, value] of Object.entries(attributes)) {
        if (key === '@_xmlns') namespaces.set('', value)
        else if (key.startsWith('@_xmlns:')) namespaces.set(key.slice(8), value)
      }
      const separator = name.indexOf(':')
      const prefix = separator < 0 ? '' : name.slice(0, separator)
      const namespace = namespaces.get(prefix) ?? ''
      const compatibleName = prefix && namespace === SPREADSHEET_NAMESPACE ? name.slice(separator + 1) : name
      if (compatibleName !== name) changed = true
      let defaultNamespace = attributes['@_xmlns'] ?? emittedDefault
      // Preserve the original namespace of unprefixed children after their parent is renamed.
      if (!compatibleName.includes(':') && namespace !== defaultNamespace) {
        attributes['@_xmlns'] = namespace
        defaultNamespace = namespace
      }
      return {
        [compatibleName]: rewrite(node[name] as XmlNode[], namespaces, defaultNamespace),
        ...(Object.keys(attributes).length ? { ':@': attributes } : {}),
      }
    })
  }
  const nodes = rewrite(new XMLParser(xmlOptions).parse(xml) as XmlNode[], new Map(), '')
  return changed ? new XMLBuilder(xmlOptions).build(nodes) : xml
}

/** Normalize a temporary read buffer; callers retain the original upload bytes and hash. */
export async function loadRegistrationWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const zip = await JSZip.loadAsync(buffer)
  let changed = false
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || !/^xl\/.*\.xml$/i.test(entry.name)) continue
    const xml = await entry.async('string')
    const compatible = compatibleSpreadsheetXml(xml)
    if (compatible !== xml) { zip.file(entry.name, compatible); changed = true }
  }
  const contents = changed ? await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }) : buffer
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(contents as unknown as ExcelJS.Buffer)
  return workbook
}
