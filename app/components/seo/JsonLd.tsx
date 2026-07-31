const JsonLd = ({ data }: { data: unknown }) => (
  <script
    type="application/ld+json"
    // Escaping "<" prevents a "</script>" substring inside any string field
    // (e.g. a description) from breaking out of the script tag.
    dangerouslySetInnerHTML={{
      __html: JSON.stringify(data).replace(/</g, "\\u003c"),
    }}
  />
);

export default JsonLd;
