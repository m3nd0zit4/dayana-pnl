import Link from "next/link";
import { ArrowUpRight, type LucideIcon } from "lucide-react";
import { buttonVariants } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
import { cn } from "@/lib/utils";

type PromoCardProps = {
  title: string;
  description: string;
  href: string;
} & ({ icon: LucideIcon; image?: never } | { icon?: never; image: string });

/** Column variant of the course-card idiom in `app/components/cursos/CourseCard.tsx`. An `image` (gif) already bakes in its own title/description art, so it IS the whole card — no separate text block. Without one, falls back to the gradient+icon block plus title/description/"Ver" pill. */
const PromoCard = ({ title, description, href, icon: Icon, image }: PromoCardProps) =>
  image ? (
    <Link
      href={href}
      className="group relative inline-block w-fit max-w-full overflow-hidden rounded-2xl transition-shadow hover:shadow-md"
    >
      {/* Static poster shows at rest; the gif only plays on hover — two
          stacked <img>s cross-fading via opacity, same technique as
          DayanaAiLogo, just CSS-driven (group-hover) instead of a JS prop. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- local png in public/, poster frame for the gif below */}
      <img
        src={image.replace(/\.gif$/, "-static.png")}
        alt={title}
        className="block max-w-full transition-opacity duration-200 group-hover:opacity-0"
      />
      {/* eslint-disable-next-line @next/next/no-img-element -- local gif in public/, animated (next/image would strip animation); cropped tight to its content, rendered at native size (no w-full stretch) */}
      <img
        src={image}
        alt=""
        aria-hidden
        className="absolute inset-0 h-full w-full opacity-0 transition-opacity duration-200 group-hover:opacity-100"
      />
      <span
        className={cn(
          buttonVariants({ variant: "secondary", size: "xs" }),
          "absolute right-2 bottom-2 gap-1 shadow-sm"
        )}
      >
        Ver
        <ArrowUpRight className="size-3.5" />
      </span>
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
