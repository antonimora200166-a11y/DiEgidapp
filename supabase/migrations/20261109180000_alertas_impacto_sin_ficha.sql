-- =====================================================================================
-- SGI Di Égida · Alertas: impacto comparable de «ventas sin ficha» (09/11/2026)
-- El impacto de las demás alertas es un costo (pesos de más o sin explicar). Para «ventas sin
-- ficha» se usaba lo vendido, que es mucho mayor y tapaba al resto al ordenar la bandeja. Ahora es
-- el costo que se espera de esas ventas según la meta de su sección: el costo que nadie controla.
-- =====================================================================================
do $$
declare v_def text; v_nueva text;
begin
  v_def := pg_get_functiondef('privado.generar_alertas(date, date)'::regprocedure);
  v_nueva := replace(v_def,
    $a$format('/fichas/%s', v_x ->> 'generico_id'), (v_x ->> 'valor_neto')::numeric, p_desde, p_hasta)::int;$a$,
    $a$format('/fichas/%s', v_x ->> 'generico_id'), (v_x ->> 'valor_neto')::numeric * (v_x ->> 'meta_pct')::numeric / 100, p_desde, p_hasta)::int;$a$);
  v_nueva := replace(v_nueva,
    $a$format('%s vendidos en el período.', to_char((v_x ->> 'unidades')::numeric, 'FM999G990')),$a$,
    $a$format('%s vendidos en el período. Impacto: el costo que se espera de esas ventas según la meta de su sección.', to_char((v_x ->> 'unidades')::numeric, 'FM999G990')),$a$);
  v_nueva := replace(v_nueva,
    $a$'/consulta/ventas', (v_calc -> 'sin_equivalencia' ->> 'valor')::numeric, p_desde, p_hasta)::int;$a$,
    $a$'/consulta/ventas', (v_calc -> 'sin_equivalencia' ->> 'valor')::numeric * privado.parametro_num('META_PCT_COSTO', 25) / 100, p_desde, p_hasta)::int;$a$);
  if v_nueva = v_def or position('META_PCT_COSTO' in v_nueva) = 0 then
    raise exception 'No se pudo ajustar privado.generar_alertas.';
  end if;
  execute v_nueva;
end
$$;
