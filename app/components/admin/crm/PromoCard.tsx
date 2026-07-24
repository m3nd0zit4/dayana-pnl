import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { buttonVariants } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
import { cn } from "@/lib/utils";

type PromoCardProps = {
  title: string;
  description: string;
  href: string;
} & ({ icon: LucideIcon; image?: never } | { icon?: never; image: string });

/** Column variant of `LearningDashboard.tsx`'s `CourseCard`/`CourseCover` idiom. An `image` (gif) already bakes in its own title/description art, so it IS the whole card — no separate text block. Without one, falls back to the gradient+icon block plus title/description/"Ver" pill. */
const PromoCard = ({ title, description, href, icon: Icon, image }: PromoCardProps) =>
  image ? (
    <Link
      href={href}
      className="block w-full max-w-xs overflow-hidden rounded-2xl transition-shadow hover:shadow-md"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- local gif in public/, animated (next/image would strip animation) */}
      <img src={image} alt={title} className="block w-full" />
    </Link>
  ) : (
    <Link href={href} className="block">
      <Card className="overflow-hidden rounded-2xl py-0 transition-shadow hover:shadow-md">
        <CardContent className="flex h-full flex-col gap-4 p-0">
          <div className="flex h-28 shrink-0 items-center justify-center bg-gradient-to-br from-primary/15 via-primary/5 to-transparent">
            {Icon && <Icon className="size-10 text-primary/50" aria-hidden />}
          </div>
          <div className="flex flex-1 flex-col gap-3 p-5 pt-0">
            <div>
              <h3 className="text-base font-semibold">{title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            </div>
            <span className={cn(buttonVariants({ variant: "outline", size: "xs" }), "mt-auto w-fit")}>
              Ver
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );

export default PromoCard;
