import { joinPdfItems } from './prep'

// pdf.js is loaded on demand from cdnjs (pinned version), so it adds nothing to the app bundle.
const VERSION = '3.11.174'
const BASE = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${VERSION}/`
let loading: Promise<any> | null = null

function loadPdfJs(): Promise<any> {
  const w = window as any
  if (w.pdfjsLib) return Promise.resolve(w.pdfjsLib)
  if (loading) return loading
  loading = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = BASE + 'pdf.min.js'
    s.onload = () => {
      if (!w.pdfjsLib) { loading = null; reject(new Error('The PDF reader did not load.')); return }
      w.pdfjsLib.GlobalWorkerOptions.workerSrc = BASE + 'pdf.worker.min.js'
      resolve(w.pdfjsLib)
    }
    s.onerror = () => { loading = null; s.remove(); reject(new Error('Could not load the PDF reader. Check your internet connection and try again.')) }
    document.head.appendChild(s)
  })
  return loading
}

// Returns the text of a PDF (first pages only). Empty string means the PDF has no selectable text, e.g. a scan.
export async function extractPdfText(file: File, maxPages = 30): Promise<string> {
  const pdfjs = await loadPdfJs()
  const data = new Uint8Array(await file.arrayBuffer())
  let doc: any
  try {
    doc = await pdfjs.getDocument({ data }).promise
  } catch (e: any) {
    throw new Error(e?.name === 'PasswordException' ? 'This PDF is password-protected. Remove the password and try again.' : 'Could not read this PDF. It may be damaged.')
  }
  const pages: string[] = []
  const last = Math.min(doc.numPages, maxPages)
  for (let i = 1; i <= last; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    pages.push(joinPdfItems(content.items))
  }
  return pages.join('\n\n').trim()
}
