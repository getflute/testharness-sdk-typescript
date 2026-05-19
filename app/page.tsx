import Harness from '@/app/_components/Harness';
import { describeConfig, fetchMerchantSnapshot } from '@/lib/flute';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const config = describeConfig();
  const merchant = config.ready ? await fetchMerchantSnapshot() : null;
  return <Harness config={config} merchant={merchant} />;
}
