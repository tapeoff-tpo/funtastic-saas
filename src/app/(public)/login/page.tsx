'use client'

import { useActionState } from 'react'
import { login } from './actions'

const initialState = { error: '' }

function loginAction(
  _prevState: { error: string },
  formData: FormData
) {
  return login(formData) as Promise<{ error: string }>
}

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(
    loginAction,
    initialState
  )

  return (
    <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-md">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-gray-900">Funtastic SaaS</h1>
        <p className="mt-1 text-sm text-gray-500">
          이커머스 통합관리 플랫폼
        </p>
      </div>

      <form action={formAction} className="space-y-4">
        <div>
          <label htmlFor="email" className="sr-only">
            이메일
          </label>
          <input
            id="email"
            name="email"
            type="email"
            placeholder="이메일"
            required
            className="w-full rounded-md border border-gray-300 px-4 py-2.5 text-sm placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label htmlFor="password" className="sr-only">
            비밀번호
          </label>
          <input
            id="password"
            name="password"
            type="password"
            placeholder="비밀번호"
            required
            className="w-full rounded-md border border-gray-300 px-4 py-2.5 text-sm placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {state.error && (
          <p className="text-sm text-red-600">{state.error}</p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? '로그인 중...' : '로그인'}
        </button>
      </form>
    </div>
  )
}
