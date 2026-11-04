import { Icon } from "./icons";
import { useEffect, useId, useRef, useState } from "react";
export function LinkFields({
  links = [],
  label = "Links",
}: {
  links?: { label: string; url: string }[];
  label?: string;
}) {
  const id = useId();
  const fieldset = useRef<HTMLFieldSetElement>(null);
  const [rows, setRows] = useState(() =>
    links.map((link, index) => ({ ...link, id: index })),
  );
  const initialRows = useRef(rows);
  const [next, setNext] = useState(links.length);
  useEffect(() => {
    if (rows === initialRows.current) return;
    fieldset.current?.dispatchEvent(new Event("input", { bubbles: true }));
  }, [rows]);
  return (
    <fieldset ref={fieldset} className="link-fields">
      <legend>{label}</legend>
      <input
        type="hidden"
        name="links"
        value={rows
          .filter((row) => row.label.trim() || row.url.trim())
          .map((row) => `${row.label.trim()} | ${row.url.trim()}`)
          .join("\n")}
      />
      {rows.map((row, index) => (
        <div className="link-field-row" key={row.id}>
          <label htmlFor={`${id}-${row.id}-label`}>
            Name
            <input
              id={`${id}-${row.id}-label`}
              value={row.label}
              required
              maxLength={100}
              pattern={String.raw`[^\|\r\n]+`}
              onChange={(event) =>
                setRows(
                  rows.map((item) =>
                    item.id === row.id
                      ? { ...item, label: event.target.value }
                      : item,
                  ),
                )
              }
            />
          </label>
          <label htmlFor={`${id}-${row.id}-url`}>
            URL
            <input
              id={`${id}-${row.id}-url`}
              type="url"
              value={row.url}
              required
              pattern="https?://.*"
              onChange={(event) =>
                setRows(
                  rows.map((item) =>
                    item.id === row.id
                      ? { ...item, url: event.target.value }
                      : item,
                  ),
                )
              }
            />
          </label>
          <button
            type="button"
            className="icon-button button-danger"
            title="Remove link"
            aria-label={`Remove link ${index + 1}`}
            onClick={() => setRows(rows.filter((item) => item.id !== row.id))}
          >
            <Icon name="trash" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => {
          setRows([...rows, { id: next, label: "", url: "" }]);
          setNext(next + 1);
        }}
      >
        <Icon name="plus" /> Add link
      </button>
    </fieldset>
  );
}
