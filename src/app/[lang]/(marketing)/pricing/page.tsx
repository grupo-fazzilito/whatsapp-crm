import { getPublicPricing } from "@/lib/billing/settings";
import { requestRegion } from "@/lib/regions-server";
import { PricingView } from "./pricing-view";

export default async function PricingPage() {
  return <PricingView pricing={await getPublicPricing(await requestRegion())} />;
}
