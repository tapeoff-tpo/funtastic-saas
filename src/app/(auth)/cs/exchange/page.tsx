import { redirect } from 'next/navigation'

export default function CsExchangePage() {
  redirect('/orders/claims?claimType=exchange')
}
