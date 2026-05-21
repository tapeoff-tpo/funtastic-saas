import { redirect } from 'next/navigation'

export default function CsCancelPage() {
  redirect('/orders/claims?claimType=cancel')
}
