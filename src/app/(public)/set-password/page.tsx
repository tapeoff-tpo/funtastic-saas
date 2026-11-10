export default async function SetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token, error } = await searchParams
  return <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-md"><h1 className="mb-4 text-xl font-bold">비밀번호 새로 설정</h1>
    <p className="mb-4 text-sm">발급받은 일회용 링크로 새 비밀번호를 설정하세요. 12자 이상 입력해주세요.</p>
    {error && <p className="text-red-600">설정 링크가 만료됐거나 비밀번호가 올바르지 않습니다.</p>}
    <form action="/api/auth/set-password" method="post" className="space-y-4">
      <input type="hidden" name="token" value={token ?? ''} />
      <input className="w-full rounded border p-3" type="password" name="password" autoComplete="new-password" minLength={12} maxLength={72} required placeholder="새 비밀번호 (12자 이상)" />
      <input className="w-full rounded border p-3" type="password" name="confirm" autoComplete="new-password" minLength={12} maxLength={72} required placeholder="비밀번호 확인" />
      <button className="w-full rounded bg-gray-900 p-3 text-white">설정하고 로그인 화면으로</button>
    </form></div>
}
