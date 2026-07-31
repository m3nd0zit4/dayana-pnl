import { notFound } from "next/navigation";
import ContentPageClient from "@/app/components/admin/crm/social/ContentPageClient";
import { getStaffSession } from "@/lib/auth/staff-session";
import { canWriteCrm } from "@/lib/crm/staff-permissions";
import { listSocialAccounts, listSocialPosts } from "@/lib/crm/social-posts";
import {
  resolveSocialPublishingEnabled,
  resolveTiktokAudited,
} from "@/lib/tiktok/resolve-flags";

export const dynamic = "force-dynamic";

const ContentPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ tiktok?: string }>;
}) => {
  if (!(await resolveSocialPublishingEnabled())) notFound();

  const staff = await getStaffSession();
  if (!staff) return null;

  const [{ tiktok }, accounts, posts, audited] = await Promise.all([
    searchParams,
    listSocialAccounts(),
    listSocialPosts(),
    resolveTiktokAudited(),
  ]);

  return (
    <ContentPageClient
      canWrite={canWriteCrm(staff.role)}
      audited={audited}
      connectResult={tiktok ?? null}
      initialAccounts={accounts.map((account) => ({
        id: account.id,
        provider: account.provider,
        displayName: account.displayName,
        username: account.username,
        isActive: account.isActive,
        lastError: account.lastError,
        expiresInDays: account.expiresInDays,
      }))}
      // Las fechas cruzan como ISO strings, igual que en el resto del panel.
      initialPosts={posts.map((post) => ({
        id: post.id,
        status: post.status,
        caption: post.caption,
        privacyLevel: post.privacyLevel,
        scheduledAt: post.scheduledAt?.toISOString() ?? null,
        publishedAt: post.publishedAt?.toISOString() ?? null,
        postUrl: post.postUrl,
        failedReason: post.failedReason,
        account: {
          username: post.account.username,
          provider: post.account.provider,
        },
      }))}
    />
  );
};

export default ContentPage;
