import { getPublicPricing } from "@/lib/billing/settings";
import { HomeView } from "./home-view";

export default async function HomePage() {
  return <HomeView pricing={await getPublicPricing()} />;
}
