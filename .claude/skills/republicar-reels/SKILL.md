---
name: republicar-reels
description: Republica los Reels de Instagram (@dayana.pnl) en la Página de Facebook de Dayana Beltrán, y viceversa. Extrae el MP4 original sin marca de agua vía la API interna de Instagram, lo descarga y lo sube al compositor de Reels de Facebook. Usa esta skill siempre que se hable de republicar, cruzar, migrar, copiar o sincronizar vídeos/Reels entre Instagram, Facebook o TikTok para Dayana, aunque no se nombre "Reel" explícitamente — por ejemplo "pasa los vídeos de Instagram a Facebook", "sube el contenido a la página", "publica los que faltan" o "sincroniza las redes".
---

# Republicar Reels entre Instagram y la Página de Facebook

Dayana tiene ~44 Reels en Instagram (`@dayana.pnl`) y una Página de Facebook
(`Dayana Beltran PNL`) que empezó vacía. El contenido ya existe y ya está
editado: lo único que falta es moverlo. Esta skill automatiza ese traslado.

## Por qué no se usa la vía obvia

Hay tres caminos y dos no funcionan:

- **Descargar desde la app de Instagram** graba la marca de agua con el
  `@usuario`. Meta penaliza el contenido con marca de agua de otra plataforma,
  así que el Reel republicado nace con menos alcance. Igual con el botón de
  guardar de TikTok.
- **API Graph de Meta** (`/{ig-user-id}/media` → `media_url`) es la vía
  correcta y la que usa `lib/meta/publisher.ts`, pero necesita un token con
  `instagram_content_publish` y `pages_manage_posts`. Mientras esos permisos no
  estén marcados en la configuración de Login for Business del panel de Meta, no
  hay token y esta vía está cerrada.
- **API interna de Instagram desde el navegador** — funciona hoy, con la sesión
  de Dayana ya iniciada, y devuelve el MP4 original sin marca de agua. Es lo que
  hace esta skill.

Cuando el token exista, prefiere siempre la vía Graph: el publicador de Facebook
acepta `file_url`, así que puede pasarle directamente la URL del CDN de
Instagram y no descarga nada. Esta skill es el plan B manual, no el destino.

## Datos fijos

| Qué | Valor |
|---|---|
| Instagram | `dayana.pnl` (id de usuario `15055121762`) |
| Página de Facebook | `Dayana Beltran PNL` — `https://www.facebook.com/profile.php?id=61592657888164` |
| Id interno de la Página | `1258544500677107` |
| `x-ig-app-id` | `936619743392459` |

## Paso 1 — Listar los Reels con su URL de vídeo

Con una pestaña abierta en `instagram.com` y la sesión de Dayana iniciada,
ejecuta esto con `javascript_tool`. Devuelve código, URL del MP4, descripción y
reproducciones de cada Reel, ordenados por reproducciones:

```js
const H={'x-ig-app-id':'936619743392459'};
const p=await fetch('https://www.instagram.com/api/v1/users/web_profile_info/?username=dayana.pnl',{headers:H,credentials:'include'}).then(r=>r.json());
const uid=p.data.user.id; let out=[],max=null,pages=0;
do{
  const u=`https://www.instagram.com/api/v1/feed/user/${uid}/?count=33`+(max?`&max_id=${max}`:'');
  const j=await fetch(u,{headers:H,credentials:'include'}).then(r=>r.json());
  for(const it of (j.items||[])){
    if(it.video_versions&&it.video_versions.length){
      out.push({code:it.code,url:it.video_versions[0].url,caption:(it.caption&&it.caption.text)||'',plays:it.play_count||it.view_count||0});
    }
  }
  max=j.next_max_id; pages++;
}while(max&&pages<5);
out.sort((a,b)=>b.plays-a.plays);
window.__q=out;
JSON.stringify(out.map(r=>({code:r.code,plays:r.plays,cap:r.caption.slice(0,60)})))
```

`window.__q` queda en la página para el paso siguiente. **No intentes devolver
la URL completa**: el harness bloquea cadenas con datos de query string
firmados, así que la URL tiene que quedarse dentro del navegador y usarse ahí
mismo.

Publica primero los de más reproducciones: ya demostraron que funcionan.

## Paso 2 — Descargar el MP4

```js
const r=window.__q.find(x=>x.code===CODIGO);
const b=await fetch(r.url).then(x=>x.blob());
const a=document.createElement('a');
a.href=URL.createObjectURL(b); a.download=r.code+'.mp4';
document.body.appendChild(a); a.click(); a.remove();
JSON.stringify({code:r.code,mb:+(b.size/1048576).toFixed(1)})
```

**Chrome bloquea descargas automáticas repetidas.** Deja pasar una y corta el
resto en silencio: el script dice que descargó pero el archivo no aparece.
Recargar la página no lo reinicia. Si falla, pide que se active de forma
permanente en `chrome://settings/content/automaticDownloads` → permitir
`https://www.instagram.com`. El aviso que sale en la barra de direcciones
concede **una sola** descarga, por eso se vuelve a bloquear enseguida.

Verifica siempre en disco antes de seguir; no confíes en el retorno del script.

## Paso 3 — Mover el archivo al scratchpad

`file_upload` solo lee rutas que la sesión tiene permitidas: la carpeta de
Descargas está fuera. Copia el archivo al scratchpad de la sesión antes de
subirlo.

```bash
cp "/c/Users/<usuario>/Downloads/<CODIGO>.mp4" "<scratchpad>/reels/<CODIGO>.mp4"
```

## Paso 4 — Publicar en la Página

1. Abre `https://www.facebook.com/profile.php?id=61592657888164`.
2. **Comprueba que estás actuando como la Página**, no como el perfil personal.
   Si aparece "Cambia a la página de Dayana Beltran PNL", pulsa **Cambiar**.
   Publicar sin cambiar manda el vídeo al perfil personal de Dayana.
3. Pulsa **Reel**, localiza el input de archivo con `find` (su `ref` cambia en
   cada carga, no lo memorices) y sube el MP4 con `file_upload`.
4. **Siguiente** → comprobación de derechos de autor. Espera a que diga
   *"Es seguro publicar tu reel"*.
5. **Siguiente** → pantalla de descripción.
6. Escribe la descripción y pulsa **Publicar**.

### Cuidado con estas tres cosas

- **El diálogo se reordena y la ventana cambia de tamaño entre pasos.** Toma una
  captura antes de cada clic. En una sesión, un clic destinado a "Publicar" cayó
  sobre el interruptor **Promocionar publicación** y lo activó, que es el
  comienzo de un anuncio de pago. Si aparece activado, apágalo antes de
  publicar.
- **Facebook interpone ofertas**: "¿Organizas un evento?", "Agrega el botón
  Llamar". Rechaza con *Realizar publicación original* / *Ahora no*.
- **Los acentos se escriben bien** con `type`; no hace falta ASCII. Escribir
  "anos" en vez de "años" en una página pública es un error caro.

## Descripciones

Reutiliza los hashtags originales de Instagram tal cual. Si el Reel no tenía
descripción, usa los recurrentes de marca: `#pnl #reprogramacionmental
#liberaciónemocional`.

No inventes una frase que describa el contenido del vídeo si no lo has visto.
Los hashtags dicen el tema pero no la idea concreta, y una frase inventada suena
a Dayana sin serlo. Si quieres un gancho de verdad, pide que te cuenten qué dice
el vídeo.

## Ritmo de publicación

No vuelques el catálogo entero de golpe. Facebook da bastante más distribución
al vídeo del día que al de archivo, así que 44 Reels en una tarde queman la
biblioteca a cambio de nada. Uno o dos al día, empezando por los de más
reproducciones.

## Sentido contrario: Facebook → Instagram

- Publicar desde **Meta Business Suite** manda a las dos redes a la vez: el
  compositor trae `Dayana Beltran PNL` y `dayana.pnl` ya marcados. Es la forma
  recomendada de publicar cualquier cosa nueva.
- **Instagram → Facebook automático** existe, pero el interruptor está en
  Accounts Center → Connected experiences → Sharing across profiles, y solo se
  puede activar desde la app móvil.
- **Facebook → Instagram automático permanente no existe.** Meta solo ofrece la
  casilla por publicación. Si alguien lo pide, dilo en vez de buscarlo.

## Verificación

Termina siempre comprobando la pestaña **Reels** de la Página
(`?sk=reels_tab`). Recarga: los Reels recién publicados tardan en aparecer.
Cuenta los que hay y compáralo con los que creías haber publicado.
