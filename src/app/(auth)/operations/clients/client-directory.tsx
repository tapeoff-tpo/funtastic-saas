'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { Plus, Save, Search, Trash2 } from 'lucide-react'
import type { QuoteWorkspaceClient as Client } from '@/lib/quotes/store'
import styles from '../../purchasing/quotes/quote-workspace.module.css'

function newClient(): Client {
  return {
    id: '', clientName: '', representativeName: '', contactName: '', contactPhone: '',
    businessRegistrationNumber: '', taxInvoiceEmail: '', address: '', recipientName: '', recipientPhone: '', recipientTitle: '',
    deliveryMessage: '', memo: '',
  }
}
function normalizeClient(input: Partial<Client> | undefined): Client {
  const base = newClient()
  return {
    ...base,
    ...input,
    id: String(input?.id || ''),
    clientName: String(input?.clientName || ''),
    representativeName: String(input?.representativeName || ''),
    contactName: String(input?.contactName || ''),
    contactPhone: String(input?.contactPhone || ''),
    businessRegistrationNumber: String(input?.businessRegistrationNumber || ''),
    taxInvoiceEmail: String(input?.taxInvoiceEmail || ''),
    address: String(input?.address || ''),
    recipientName: String(input?.recipientName || ''),
    recipientPhone: String(input?.recipientPhone || ''),
    recipientTitle: String(input?.recipientTitle || ''),
    deliveryMessage: String(input?.deliveryMessage || ''),
    memo: String(input?.memo || ''),
  }
}
async function clientApi<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || '거래처 정보를 처리하지 못했습니다.')
  return data as T
}
export default function ClientDirectoryPage({ initialClients }: { initialClients: Client[] }) {
  const [clients, setClients] = useState<Client[]>(initialClients)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null)
  const saveClient = async (input: Client): Promise<Client | null> => {
    if (!input.clientName.trim()) {
      setNotice({ text: '거래처명을 입력해주세요.', error: true })
      return null
    }
    const existing = clients.some((entry) => entry.id === input.id)
    setSaving(true)
    try {
      const url = existing
        ? `/api/purchasing/quotes/clients/${encodeURIComponent(input.id)}`
        : '/api/purchasing/quotes/clients'
      const result = await clientApi<{ client: Client }>(url, {
        method: existing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client: input }),
      })
      const saved = normalizeClient(result.client)
      setClients((current) => [saved, ...current.filter((entry) => entry.id !== saved.id)].sort((left, right) => left.clientName.localeCompare(right.clientName, 'ko-KR')))
      setNotice({ text: existing ? '거래처 정보를 수정했습니다.' : '거래처 정보를 등록했습니다.' })
      return saved
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : '거래처 정보를 저장하지 못했습니다.', error: true })
      return null
    } finally { setSaving(false) }
  }
  const removeClient = async (target: Client): Promise<boolean> => {
    if (!target.id) return false
    setSaving(true)
    try {
      await clientApi(`/api/purchasing/quotes/clients/${encodeURIComponent(target.id)}`, { method: 'DELETE' })
      setClients((current) => current.filter((entry) => entry.id !== target.id))
      setNotice({ text: '거래처 정보를 삭제했습니다. 기존 영업건과 견적서의 저장된 정보는 유지됩니다.' })
      return true
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : '거래처 정보를 삭제하지 못했습니다.', error: true })
      return false
    } finally { setSaving(false) }
  }
  return <>
    {notice ? <div role="status" className={[styles.notice, notice.error ? styles.noticeError : styles.noticeSuccess].join(' ')}><span>{notice.text}</span><button type="button" onClick={() => setNotice(null)}>닫기</button></div> : null}
    <ClientDirectory clients={clients} saving={saving} onSave={saveClient} onDelete={removeClient} />
  </>
}

function ClientDirectory(props: {
  clients: Client[]; saving: boolean
  onSave: (client: Client) => Promise<Client | null>; onDelete: (client: Client) => Promise<boolean>
}) {
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState<Client | null>(null)
  const shownClients = useMemo(() => {
    const term = search.trim().toLowerCase()
    return props.clients
      .filter((client) => !term || [
        client.clientName, client.representativeName, client.contactName, client.contactPhone,
        client.businessRegistrationNumber, client.taxInvoiceEmail, client.address, client.memo,
      ].join(' ').toLowerCase().includes(term))
      .slice()
      .sort((left, right) => left.clientName.localeCompare(right.clientName, 'ko-KR'))
  }, [props.clients, search])
  const update = <K extends keyof Client>(field: K, input: Client[K]) => {
    setDraft((current) => current ? { ...current, [field]: input } : current)
  }
  const save = async () => {
    if (!draft) return
    const saved = await props.onSave(draft)
    if (saved) setDraft(saved)
  }
  const remove = async () => {
    if (!draft || !draft.id || !window.confirm(`${draft.clientName || '이 거래처'} 정보를 삭제할까요?\n\n기존 영업건과 견적서에 저장된 정보는 유지됩니다.`)) return
    if (await props.onDelete(draft)) setDraft(null)
  }
  return <main className={styles.page}>
    <section className={styles.listHead}><div><h1>거래처 정보</h1><p>우리와 거래하는 업체의 기본 정보를 등록하고, 영업건·견적서에서 바로 불러옵니다.</p></div><div className={styles.actions}><button type="button" className={styles.primary} onClick={() => setDraft(newClient())}><Plus size={15} /> 새 거래처</button></div></section>
    <section className={styles.listCard}>
      <div className={styles.filters}><label className={styles.search}><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="거래처명, 담당자, 연락처, 사업자번호 검색" /></label><span>{shownClients.length.toLocaleString('ko-KR')}개 거래처</span></div>
      <div className={styles.scroll}><table className={styles.table}><thead><tr><th>거래처명</th><th>대표자 · 담당자</th><th>연락처</th><th>사업자번호</th><th>세금계산서 이메일</th><th>주소</th><th className={styles.noPrint}>관리</th></tr></thead><tbody>{shownClients.length ? shownClients.map((client) => <tr key={client.id}><td><strong>{client.clientName}</strong></td><td>{[client.representativeName, client.contactName].filter(Boolean).join(' · ') || '-'}</td><td>{client.contactPhone || '-'}</td><td>{client.businessRegistrationNumber || '-'}</td><td>{client.taxInvoiceEmail || '-'}</td><td>{client.address || '-'}</td><td className={styles.noPrint}><div className={styles.rowActions}><button type="button" className={styles.light} onClick={() => setDraft(normalizeClient(client))}>수정</button></div></td></tr>) : <tr><td colSpan={7} className={styles.empty}>{search ? '일치하는 거래처가 없습니다.' : '등록된 거래처가 없습니다. 새 거래처를 등록해 주세요.'}</td></tr>}</tbody></table></div>
    </section>
    {draft ? <section className={styles.section}><div className={styles.clientFormHead}><div><h2>{draft.id ? '거래처 정보 수정' : '새 거래처 등록'}</h2><p>여기에서 저장한 정보는 선택할 때만 영업건과 견적서에 복사됩니다.</p></div><div className={styles.actions}><button type="button" className={styles.light} disabled={props.saving} onClick={() => setDraft(null)}>닫기</button>{draft.id ? <button type="button" className={styles.danger} disabled={props.saving} onClick={() => void remove()}><Trash2 size={14} /> 삭제</button> : null}<button type="button" className={styles.primary} disabled={props.saving} onClick={() => void save()}><Save size={15} /> {props.saving ? '저장 중' : '저장'}</button></div></div><div className={styles.fields}><Field label="거래처명"><input value={draft.clientName} onChange={(event) => update('clientName', event.target.value)} placeholder="예: 주식회사 펀타" /></Field><Field label="대표자"><input value={draft.representativeName} onChange={(event) => update('representativeName', event.target.value)} /></Field><Field label="담당자"><input value={draft.contactName} onChange={(event) => update('contactName', event.target.value)} /></Field><Field label="담당자 연락처"><input value={draft.contactPhone} onChange={(event) => update('contactPhone', event.target.value)} /></Field><Field label="사업자등록번호"><input value={draft.businessRegistrationNumber} onChange={(event) => update('businessRegistrationNumber', event.target.value)} /></Field><Field label="세금계산서 이메일"><input type="email" value={draft.taxInvoiceEmail} onChange={(event) => update('taxInvoiceEmail', event.target.value)} /></Field><Field label="주소" wide><input value={draft.address} onChange={(event) => update('address', event.target.value)} /></Field><Field label="기본 수령인"><input value={draft.recipientName} onChange={(event) => update('recipientName', event.target.value)} /></Field><Field label="기본 수령인 연락처"><input value={draft.recipientPhone} onChange={(event) => update('recipientPhone', event.target.value)} /></Field><Field label="견적서 수신 표기" wide><input value={draft.recipientTitle} onChange={(event) => update('recipientTitle', event.target.value)} placeholder="예: 대표이사 귀하" /></Field><Field label="기본 배송 메모" wide><textarea rows={2} value={draft.deliveryMessage} onChange={(event) => update('deliveryMessage', event.target.value)} /></Field><Field label="관리 메모" wide><textarea rows={3} value={draft.memo} onChange={(event) => update('memo', event.target.value)} placeholder="거래 조건 등 내부에서만 볼 메모" /></Field></div></section> : null}
  </main>
}

function Field({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return <label className={wide ? styles.fieldWide : styles.field}><span>{label}</span>{children}</label>
}
