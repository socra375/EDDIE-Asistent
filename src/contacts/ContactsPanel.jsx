import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import Icon from '../layout/Icon';
import { canPickContacts, deleteContact, listContacts, pickContacts, saveContact } from '../services/contacts';
import { instagramLink, matchContacts, normalizePhone, smsLink, whatsappLink } from '../services/contactsCore';
import { copyText } from '../services/messageActions';
import { startCall } from '../services/callState';
import './Contacts.css';

const EMPTY = { id: null, name: '', phone: '', instagram: '', email: '', notes: '', self: false };

// Contactos: Eddie's address book. Add, edit and delete people, mark your own
// number (the one Eddie uses to reach you) and write to anyone in one tap:
// WhatsApp, SMS or Instagram open with the message ready and you press send.
// Eddie reads the same list when you ask for a number or say «crea un mensaje
// para Ana» (api/_lib/connectors/contacts).
export default function ContactsPanel() {
  const { user, login } = useAuth();
  const [state, setState] = useState({ status: 'loading', items: [], configured: true });
  const [query, setQuery] = useState('');
  const [form, setForm] = useState(null); // the contact being added or edited
  const [openId, setOpenId] = useState(null);
  const [draft, setDraft] = useState('');
  const [confirmId, setConfirmId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState({ tone: '', text: '' });
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const data = await listContacts();
      if (alive.current) setState({ status: 'ready', items: data.items || [], configured: data.configured !== false });
    } catch (err) {
      if (alive.current) {
        setState((s) => ({ ...s, status: 'error' }));
        setMessage({ tone: 'bad', text: err.message });
      }
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    const first = user ? window.setTimeout(refresh, 0) : null;
    return () => {
      alive.current = false;
      window.clearTimeout(first);
    };
  }, [user, refresh]);

  const shown = useMemo(() => (query.trim() ? matchContacts(state.items, query, { limit: 100 }) : state.items), [state.items, query]);

  async function submit(e) {
    e.preventDefault();
    if (!form || busy) return;
    setBusy(true);
    setMessage({ tone: '', text: '' });
    try {
      const { item } = await saveContact({ ...form, id: form.id || undefined });
      if (!alive.current) return;
      await refresh();
      setOpenId(item.id);
      setForm(null);
      setMessage({ tone: 'ok', text: form.id ? 'Contacto actualizado.' : 'Contacto guardado.' });
    } catch (err) {
      if (alive.current) setMessage({ tone: 'bad', text: err.message });
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function remove(id) {
    if (confirmId !== id) {
      setConfirmId(id);
      return;
    }
    setBusy(true);
    try {
      await deleteContact(id);
      if (!alive.current) return;
      setState((s) => ({ ...s, items: s.items.filter((c) => c.id !== id) }));
      setOpenId(null);
      setConfirmId(null);
      setMessage({ tone: 'ok', text: 'Contacto borrado.' });
    } catch (err) {
      if (alive.current) setMessage({ tone: 'bad', text: err.message });
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function importFromPhone() {
    setBusy(true);
    setMessage({ tone: '', text: '' });
    try {
      const picked = await pickContacts();
      const known = new Set(state.items.map((c) => normalizePhone(c.phone)).filter(Boolean));
      let added = 0;
      for (const p of picked) {
        const digits = normalizePhone(p.phone);
        if (digits && known.has(digits)) continue;
        await saveContact({ name: p.name, phone: digits ? p.phone : '' });
        if (digits) known.add(digits);
        added += 1;
      }
      if (alive.current) {
        await refresh();
        setMessage({ tone: 'ok', text: picked.length ? `Añadí ${added} de ${picked.length} (los repetidos se saltaron).` : 'No elegiste ningún contacto.' });
      }
    } catch (err) {
      if (alive.current) setMessage({ tone: 'bad', text: err.name === 'AbortError' ? '' : err.message || 'No pude abrir tus contactos.' });
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function copyAndOpenInstagram(c) {
    if (draft.trim()) await copyText(draft.trim());
    window.open(instagramLink(c.instagram), '_blank', 'noopener,noreferrer');
    setMessage({ tone: 'ok', text: draft.trim() ? 'Copié el mensaje: pégalo en el chat de Instagram y envíalo.' : '' });
  }

  if (!user) {
    return (
      <section className="contacts" aria-label="Contactos">
        <div className="glass-panel contacts__card">
          <h3>Contactos</h3>
          <p className="contacts__note">Inicia sesión con Google para guardar tus contactos y que Eddie los use en tus mensajes.</p>
          <button type="button" className="btn btn-primary" onClick={login}>
            Iniciar sesión con Google
          </button>
        </div>
      </section>
    );
  }

  const field = (key, label, props = {}) => (
    <label className="contacts__field">
      <span>{label}</span>
      <input className="input" value={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} {...props} />
    </label>
  );

  return (
    <section className="contacts" aria-label="Contactos">
      <div className="glass-panel contacts__card">
        <header className="contacts__head">
          <h3>Contactos</h3>
          <span className="chip">{state.items.length} guardados</span>
        </header>
        {!state.configured && <p className="contacts__note contacts__note--bad">Falta configurar la base de datos en Vercel.</p>}
        <div className="contacts__bar">
          <input className="input" type="search" placeholder="Buscar por nombre, nota o Instagram…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar un contacto" />
          <button type="button" className="btn btn-primary" onClick={() => { setForm({ ...EMPTY }); setMessage({ tone: '', text: '' }); }} disabled={busy}>
            <Icon name="plus" size={16} /> Añadir
          </button>
          <button type="button" className="btn" onClick={() => startCall()} disabled={busy}>
            <Icon name="phone" size={16} /> Llamar a Eddie
          </button>
          {canPickContacts() && (
            <button type="button" className="btn" onClick={importFromPhone} disabled={busy}>
              Importar del teléfono
            </button>
          )}
        </div>
        {message.text && <p className={`contacts__msg contacts__msg--${message.tone}`} role="status">{message.text}</p>}
        {!canPickContacts() && <p className="contacts__note">Importar desde la agenda del teléfono solo funciona en Chrome para Android; en iPhone añade los contactos aquí o díselos a Eddie («guarda a Ana, su número es…»).</p>}
      </div>

      {form && (
        <form className="glass-panel contacts__card" onSubmit={submit} aria-label={form.id ? 'Editar contacto' : 'Nuevo contacto'}>
          <h3>{form.id ? 'Editar contacto' : 'Nuevo contacto'}</h3>
          {field('name', 'Nombre', { required: true, maxLength: 80, autoFocus: true })}
          {field('phone', 'Teléfono (con código de país)', { type: 'tel', maxLength: 25, placeholder: '+1 809 555 1234' })}
          {field('instagram', 'Instagram', { maxLength: 120, placeholder: '@usuario' })}
          {field('email', 'Correo', { type: 'email', maxLength: 120 })}
          {field('notes', 'Notas', { maxLength: 500, placeholder: 'Quién es, qué le vendiste…' })}
          <label className="contacts__check">
            <input type="checkbox" checked={form.self} onChange={(e) => setForm((f) => ({ ...f, self: e.target.checked }))} />
            <span>Este es mi número (el que Eddie usa para llamarme)</span>
          </label>
          <div className="contacts__row">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Guardando…' : 'Guardar'}
            </button>
            <button type="button" className="btn" onClick={() => setForm(null)} disabled={busy}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      {state.status === 'ready' && shown.length === 0 && (
        <p className="contacts__empty">{query.trim() ? 'No hay nadie con ese nombre.' : 'Aún no tienes contactos. Pulsa «Añadir» o dile a Eddie: «guarda a Ana, su número es +1 809 555 1234».'}</p>
      )}

      <ul className="contacts__list">
        {shown.map((c) => {
          const open = openId === c.id;
          const digits = normalizePhone(c.phone);
          return (
            <li key={c.id} className={`glass-panel contacts__item ${open ? 'contacts__item--open' : ''}`}>
              <button type="button" className="contacts__summary" aria-expanded={open} onClick={() => { setOpenId(open ? null : c.id); setConfirmId(null); setDraft(''); }}>
                <span className="contacts__avatar" aria-hidden="true">{c.name.slice(0, 1).toUpperCase()}</span>
                <span className="contacts__who">
                  <strong>{c.name}</strong>
                  <small>{c.phone || (c.instagram ? `@${c.instagram}` : c.email || 'Sin datos')}</small>
                </span>
                {c.self && <span className="chip contacts__me">Yo</span>}
              </button>
              {open && (
                <div className="contacts__detail">
                  <dl>
                    {c.phone && (<><dt>Teléfono</dt><dd>{c.phone}</dd></>)}
                    {c.instagram && (<><dt>Instagram</dt><dd>@{c.instagram}</dd></>)}
                    {c.email && (<><dt>Correo</dt><dd>{c.email}</dd></>)}
                    {c.notes && (<><dt>Notas</dt><dd>{c.notes}</dd></>)}
                  </dl>
                  {!c.self && (digits || c.instagram) && (
                    <div className="contacts__compose">
                      <textarea className="input" rows={3} maxLength={1000} placeholder={`Escribe el mensaje para ${c.name}…`} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={`Mensaje para ${c.name}`} />
                      <div className="contacts__row">
                        {digits && (
                          <a className="btn" href={whatsappLink(digits, draft.trim())} target="_blank" rel="noopener noreferrer">WhatsApp</a>
                        )}
                        {digits && (
                          <a className="btn" href={smsLink(digits, draft.trim())}>SMS</a>
                        )}
                        {c.instagram && (
                          <button type="button" className="btn" onClick={() => copyAndOpenInstagram(c)}>Instagram</button>
                        )}
                        {digits && (
                          <a className="btn" href={`tel:+${digits}`}>Llamar</a>
                        )}
                      </div>
                      <p className="contacts__note">Se abre la aplicación con el mensaje escrito; tú pulsas enviar. Instagram copia el texto y abre el chat para pegarlo.</p>
                    </div>
                  )}
                  <div className="contacts__row">
                    <button type="button" className="btn" onClick={() => { setForm({ ...EMPTY, ...c }); setMessage({ tone: '', text: '' }); }} disabled={busy}>Editar</button>
                    <button type="button" className="btn btn-danger" onClick={() => remove(c.id)} disabled={busy}>
                      {confirmId === c.id ? 'Confirmar: borrar' : 'Borrar'}
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
