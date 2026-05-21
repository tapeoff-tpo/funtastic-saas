import { redirect } from 'next/navigation'

export default function CsReturnPage() {
  redirect('/orders/claims?claimType=return')
}
