import Content from "./workspace-content"
export { metadata } from "./workspace-content"

export default function InventoryPage({ searchParams }: { searchParams: Parameters<typeof Content>[0]["searchParams"] }) {
  return <Content searchParams={searchParams} />
}
