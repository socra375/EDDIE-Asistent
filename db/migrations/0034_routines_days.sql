-- Rutinas en días concretos: "de lunes a viernes", "solo los fines de semana", "los lunes y los jueves".
-- `days` guarda los días en que corre como números separados por coma (0 = domingo … 6 = sábado,
-- como Date.getDay), p. ej. '1,2,3,4,5'. Vacío (null) = todos los días, como hasta ahora, así que
-- las rutinas que ya existen no cambian. Aditiva: el código viejo la ignora.
alter table routines add column if not exists days text;
