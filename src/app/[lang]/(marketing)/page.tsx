import { getPublicPricing } from "@/lib/billing/settings";
import { requestRegion } from "@/lib/regions-server";
import { HomeView } from "./home-view";

export default async function HomePage() {
  return <HomeView pricing={await getPublicPricing(await requestRegion())} />;
}
