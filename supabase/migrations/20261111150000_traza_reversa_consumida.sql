-- =====================================================================================
-- SGI Di Égida · Trazabilidad · reversa de una entrada ya consumida (11/11/2026)
-- Al anular una recepción o un lote cuyo producto ya se había usado, la reversa consumía la
-- partida completa y la dejaba con restante negativo (5 kg de limón comprados, 2 kg usados:
-- la partida quedaba en −2 kg). Ahora la reversa saca de cada partida solo lo que le queda y
-- el resto queda «sin partida»: es lo que ya había salido y deja el saldo del kardex negativo
-- hasta el siguiente conteo. La existencia por partidas sigue igual a la del kardex.
-- Solo cambia la rama de reversa de entrada; lo demás es igual a 20261107180000_trazabilidad.
-- =====================================================================================

create or replace function privado.trazar(m public.movimientos)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  o         public.movimientos;
  v_pend    numeric;
  v_toma    numeric;
  v_pref    uuid := privado.uuid_o_null(nullif(current_setting('sgi.origen_preferido', true), ''));
  v_tipo    text;
  v_vence   date;
  s         public.movimientos;
  r         record;
begin
  if m.tipo = 'REVERSA' then
    select * into o from public.movimientos where id = m.reversa_de;
    if o.cantidad < 0 then
      -- deshacer una salida: lo que salió vuelve a las mismas partidas
      insert into public.partida_consumos (partida_id, movimiento_id, producto_id, ubicacion, cantidad)
      select c.partida_id, m.id, c.producto_id, c.ubicacion, -c.cantidad from public.partida_consumos c where c.movimiento_id = o.id;
    else
      -- deshacer una entrada: sus partidas se consumen en lo que les queda; lo ya usado queda sin partida
      v_pend := o.cantidad;
      for r in select p.id, privado.restante_partida(p.id) as resto
                 from public.partidas p where p.movimiento_id = o.id
                order by p.creado_en, p.id loop
        exit when v_pend <= 0;
        continue when r.resto <= 0;
        v_toma := least(r.resto, v_pend);
        insert into public.partida_consumos (partida_id, movimiento_id, producto_id, ubicacion, cantidad)
        values (r.id, m.id, o.producto_id, o.ubicacion, v_toma);
        v_pend := v_pend - v_toma;
      end loop;
      if v_pend > 0 then
        insert into public.partida_consumos (partida_id, movimiento_id, producto_id, ubicacion, cantidad)
        values (null, m.id, o.producto_id, o.ubicacion, v_pend);
      end if;
    end if;
    return;
  end if;

  if m.cantidad > 0 then
    if m.tipo = 'TRASLADO_ENTRADA' then
      -- la salida del mismo traslado: sus partidas pasan a la zona de destino como hijas
      select * into s from public.movimientos x
       where x.tipo = 'TRASLADO_SALIDA' and x.documento_id = m.documento_id and x.producto_id = m.producto_id
         and x.cantidad = -m.cantidad and x.id < m.id
       order by x.id desc limit 1;   -- registrar_traslado anota la salida y enseguida su entrada
      if s.id is not null then
        for r in select c.partida_id, c.cantidad, p.origen_tipo, p.origen_doc, p.origen_linea, p.fecha, p.vence
                   from public.partida_consumos c left join public.partidas p on p.id = c.partida_id
                  where c.movimiento_id = s.id and c.cantidad > 0 order by c.id loop
          insert into public.partidas (producto_id, ubicacion, origen_tipo, origen_doc, origen_linea, movimiento_id, padre_id, fecha, vence, cantidad)
          values (m.producto_id, m.ubicacion, coalesce(r.origen_tipo, 'TRASLADO'), coalesce(r.origen_doc, m.documento_id), r.origen_linea,
                  m.id, r.partida_id, coalesce(r.fecha, m.fecha), r.vence, r.cantidad);
        end loop;
        return;
      end if;
    end if;
    v_tipo := case m.tipo when 'ENTRADA_COMPRA' then 'RECEPCION' when 'ENTRADA_PRODUCCION' then 'LOTE'
                          when 'SALDO_INICIAL' then 'SALDO_INICIAL' when 'AJUSTE_CONTEO_POSITIVO' then 'AJUSTE'
                          when 'TRASLADO_ENTRADA' then 'TRASLADO' else 'OTRO' end;
    v_vence := case v_tipo
                 when 'RECEPCION' then (select rl.vencimiento from public.recepcion_lineas rl where rl.id = m.linea_id)
                 when 'LOTE' then (select l.vence from public.lotes_produccion l where l.id = m.documento_id) end;
    insert into public.partidas (producto_id, ubicacion, origen_tipo, origen_doc, origen_linea, movimiento_id, fecha, vence, cantidad)
    values (m.producto_id, m.ubicacion, v_tipo, m.documento_id, m.linea_id, m.id, m.fecha, v_vence, m.cantidad);
    return;
  end if;

  -- salida: primero el origen escaneado, luego lo que vence primero, luego lo más viejo
  v_pend := -m.cantidad;
  for r in
    select p.id, privado.restante_partida(p.id) as resto
      from public.partidas p
     where p.producto_id = m.producto_id and p.ubicacion = m.ubicacion
     order by (v_pref is not null and p.origen_doc = v_pref) desc, p.vence nulls last, p.fecha, p.creado_en, p.id
  loop
    exit when v_pend <= 0;
    continue when r.resto <= 0;
    v_toma := least(r.resto, v_pend);
    insert into public.partida_consumos (partida_id, movimiento_id, producto_id, ubicacion, cantidad)
    values (r.id, m.id, m.producto_id, m.ubicacion, v_toma);
    v_pend := v_pend - v_toma;
  end loop;
  if v_pend > 0 then
    insert into public.partida_consumos (partida_id, movimiento_id, producto_id, ubicacion, cantidad)
    values (null, m.id, m.producto_id, m.ubicacion, v_pend);
  end if;
end
$$;
revoke execute on function privado.trazar(public.movimientos) from public;
