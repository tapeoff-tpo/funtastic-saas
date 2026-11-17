import Content from "./workspace-content"
export const dynamic = 'force-dynamic'

export default function MarketplaceRegistrationPage({ searchParams }: { searchParams: Parameters<typeof Content>[0]["searchParams"] }) {
  return <Content searchParams={searchParams} />
}
