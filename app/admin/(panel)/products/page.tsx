import ProductsPageClient from "@/app/components/admin/crm/ProductsPageClient";
import { isCrmUiPreview } from "@/lib/auth/preview";

export const dynamic = "force-dynamic";

const ProductsPage = () => <ProductsPageClient preview={isCrmUiPreview()} />;

export default ProductsPage;
