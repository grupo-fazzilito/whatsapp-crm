import { getPublicPricing } from "@/lib/billing/settings";
import { PricingView } from "./pricing-view";

export default async function PricingPage() {
  return <PricingView pricing={await getPublicPricing()} />;
}
