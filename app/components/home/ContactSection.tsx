"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useRef } from "react";
import WhatsAppButton from "../ui/WhatsAppButton";
import SplitReveal from "../ui/SplitReveal";

gsap.registerPlugin(ScrollTrigger);

const ContactSection = () => {
  const rootRef = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      gsap.utils.toArray<HTMLElement>(".ct-reveal").forEach((el) => {
        gsap.from(el, {
          y: 50,
          opacity: 0,
          duration: 0.9,
          ease: "power3.out",
          scrollTrigger: { trigger: el, start: "top 88%" },
        });
      });
    },
    { scope: rootRef }
  );

  return (
    <section
      ref={rootRef}
      id="contacto"
      data-nav-color="white"
      className="bg-black text-white scroll-mt-20 px-3 lg:px-8 py-32 text-center relative z-10"
    >
      <SplitReveal
        text={"¿Lista para\ndar el paso?"}
        className="font-[font2] text-5xl lg:text-[8vw] uppercase leading-[0.95]"
      />
      <p className="ct-reveal font-[font1] mt-8 lg:mt-12 mx-auto max-w-2xl text-lg lg:text-2xl text-white/80">
        Si sentiste que algo te llamó, no es casualidad. Escríbenos y vemos
        juntas qué proceso encaja contigo.
      </p>
      <div className="ct-reveal mt-12">
        <WhatsAppButton
          message="Hola Dayana, vengo desde la web. Quiero conocer más sobre el proceso."
          label="Escribir por WhatsApp"
          size="lg"
        />
      </div>
    </section>
  );
};

export default ContactSection;
