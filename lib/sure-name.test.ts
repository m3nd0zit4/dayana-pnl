import { describe, expect, test } from "bun:test";

import { fixNameInReply, resolvePersonName, selfIntroducedName, sureFirstName, type NameMessage } from "./sure-name";

const person = (text: string): NameMessage => ({ from: "person", text });
const assistant = (text: string): NameMessage => ({ from: "assistant", text });
const dayana = (text: string): NameMessage => ({ from: "dayana", text });

describe("resolvePersonName (Fely Mateo, 18-oct)", () => {
  test("solo el perfil de WhatsApp: no es seguro", () => {
    const r = resolvePersonName({ profile: "Fely Mateo", messages: [person("Hola Dayana, te escribo desde tu página de enlaces.")] });
    expect(r).toEqual({ kind: "unsure", candidates: ["Fely Mateo"] });
    expect(sureFirstName(r)).toBeNull();
  });

  test("el nombre que escribió al inscribirse sí es seguro, y el del perfil no se usa", () => {
    const r = resolvePersonName({ profile: "Fely Mateo", contact: { name: "Felicitas Mateo", typed: true }, messages: [] });
    expect(r).toMatchObject({ kind: "sure", first: "Felicitas", how: "form" });
    expect(r.kind === "sure" && r.avoid).toEqual(["Fely Mateo", "Fely"]);
  });

  test("un contacto copiado del perfil no confirma nada", () => {
    const r = resolvePersonName({ profile: "Fely Mateo", contact: { name: "Fely Mateo", typed: false }, messages: [] });
    expect(r.kind).toBe("unsure");
  });

  test("lo que ella dice en el chat manda", () => {
    const r = resolvePersonName({
      profile: "Fely Mateo",
      contact: { name: "Felicitas Mateo", typed: true },
      messages: [person("Hola, me llamo Fely, así me dicen todos")],
    });
    expect(r).toMatchObject({ kind: "sure", first: "Fely", how: "said" });
  });

  test("contestó su nombre a «¿Con quién tengo el gusto?»", () => {
    const r = resolvePersonName({
      profile: "DIOS ES MI PROVEEDOR 🙏",
      messages: [person("Hola"), assistant("Hola, te bendigo. Soy la asistente de Dayana. ¿Con quién tengo el gusto?"), person("Marleny 🙏")],
    });
    expect(r).toMatchObject({ kind: "sure", full: "Marleny", how: "said" });
  });

  test("a esa pregunta, «Hola» o «Estoy bien» no son un nombre", () => {
    const ask = assistant("¿Con quién tengo el gusto? ¿Cómo estás?");
    expect(resolvePersonName({ profile: null, messages: [ask, person("Hola")] }).kind).toBe("unknown");
    expect(resolvePersonName({ profile: null, messages: [ask, person("Estoy bien")] }).kind).toBe("unknown");
    expect(resolvePersonName({ profile: null, messages: [ask, person("Muy bien gracias")] }).kind).toBe("unknown");
  });

  test("cómo la llama Dayana en sus mensajes", () => {
    const r = resolvePersonName({ profile: "Rosa Pérez", messages: [person("Buenas"), dayana("Hola Rosa, te bendigo. ¿Cómo sigues?")] });
    expect(r).toMatchObject({ kind: "sure", full: "Rosa Pérez", first: "Rosa", how: "dayana" });
    // «la luz de Dios» no es llamarla Luz.
    expect(resolvePersonName({ profile: "Luz Marina", messages: [dayana("Que la luz de Dios te acompañe")] }).kind).toBe("unsure");
  });

  test("un perfil que no es un nombre: no se sabe", () => {
    expect(resolvePersonName({ profile: "DIOS ES MI PROVEEDOR 🙏", messages: [] })).toEqual({ kind: "unknown", profile: "DIOS ES MI PROVEEDOR 🙏" });
  });
});

describe("selfIntroducedName", () => {
  test("se presenta", () => {
    expect(selfIntroducedName("Hola buenas, me llamo ana maria y quiero información")).toBe("Ana Maria");
    expect(selfIntroducedName("mi nombre es Felicitas Mateo")).toBe("Felicitas Mateo");
    expect(selfIntroducedName("Hola, soy Rosa, de Lima")).toBe("Rosa");
    expect(selfIntroducedName("Buenas tardes, te habla Gloria")).toBe("Gloria");
  });
  test("«soy» sin un nombre detrás", () => {
    expect(selfIntroducedName("Soy colombiana y vivo en Madrid")).toBeNull();
    expect(selfIntroducedName("Soy Colombiana")).toBeNull();
    expect(selfIntroducedName("soy nueva por aquí")).toBeNull();
    expect(selfIntroducedName("soy la mamá de Sofía")).toBeNull();
    expect(selfIntroducedName("Gracias por aceptarme en su grupo")).toBeNull();
  });
});

describe("fixNameInReply", () => {
  const unsure = resolvePersonName({ profile: "Fely Mateo", messages: [] });
  const sure = resolvePersonName({ profile: "Fely Mateo", contact: { name: "Felicitas Mateo", typed: true }, messages: [] });

  test("sin nombre seguro, el del perfil se quita", () => {
    expect(fixNameInReply("Hola Fely, te bendigo. Soy la asistente de Dayana. ¿Cómo estás?", unsure)).toBe(
      "Hola, te bendigo. Soy la asistente de Dayana. ¿Cómo estás?"
    );
    expect(fixNameInReply("Con gusto, Fely 🙏", unsure)).toBe("Con gusto 🙏");
    expect(fixNameInReply("Fely, te cuento que el webinar es el domingo.", unsure)).toBe("Te cuento que el webinar es el domingo.");
    expect(fixNameInReply("Hola Fely Mateo 🙏", unsure)).toBe("Hola 🙏");
    expect(fixNameInReply("Gracias, Fely.", unsure)).toBe("Gracias.");
    // Un enlace que queda al principio no se toca (salió «Https://meet…» en la evaluación).
    expect(fixNameInReply("Fely, https://meet.google.com/abc-defg-hij", unsure)).toBe("https://meet.google.com/abc-defg-hij");
  });

  test("con el seguro, el otro nombre se cambia por el seguro", () => {
    expect(fixNameInReply("Con gusto, Fely 🙏", sure)).toBe("Con gusto, Felicitas 🙏");
    expect(fixNameInReply("Hola Fely, te bendigo.", sure)).toBe("Hola Felicitas, te bendigo.");
    expect(fixNameInReply("Con gusto, Felicitas 🙏", sure)).toBe("Con gusto, Felicitas 🙏");
  });

  test("solo donde es a quién se le habla", () => {
    const paz = resolvePersonName({ profile: "Paz", messages: [] });
    expect(fixNameInReply("Que la paz de Dios te acompañe.", paz)).toBe("Que la paz de Dios te acompañe.");
    expect(fixNameInReply("Hola, te bendigo.", unsure)).toBe("Hola, te bendigo.");
  });
});
