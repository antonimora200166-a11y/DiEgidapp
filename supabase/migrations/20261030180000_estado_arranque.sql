-- =====================================================================================
-- SGI Di Égida · 17 · ¿Listo para arrancar?
-- public.estado_arranque(área): lo que falta para operar con la app en un área, como una lista
-- de puntos {clave, titulo, estado, valor, detalle, ejemplos}. estado: 'ok' · 'aviso' (se puede
-- arrancar, pero conviene resolverlo) · 'falta' (sin esto el kardex no arranca bien).
-- Solo lee. La ven administración, auditoría y el jefe del área.
-- =====================================================================================

create or replace function public.estado_arranque(p_area public.area_app)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v jsonb := '[]';
  n_oper int; n_jefes int;
  n_zonas int; n_zonas_ini int; v_zonas_sin text[];
  n_prod int; n_kardex int;
  n_sin_costo int; v_sin_costo text[];
  n_taras int; v_taras text[];
  n_prov int; n_pares int;
  n_fichas_mal int; v_fichas text[]; n_mpi_sin_ficha int;
  n_frio int; n_proveedores int;
begin
  if not (privado.tiene_rol('admin', 'auditor') or privado.edita_area(p_area)) then
    raise exception 'Solo administración o el jefe del área ven el estado de arranque.' using errcode = '42501';
  end if;

  -- personas que registran en el área (sin contar administración) y jefes
  select count(*) filter (where pe.rol in ('jefe_bar', 'aux_bar', 'chef', 'sous_chef', 'aux_cocina')),
         count(*) filter (where (p_area = 'BAR' and pe.rol = 'jefe_bar') or (p_area = 'COCINA' and pe.rol = 'chef'))
    into n_oper, n_jefes
    from public.perfiles pe where pe.activo and p_area = any (pe.areas);
  v := v || jsonb_build_object('clave', 'usuarios', 'titulo', 'Usuarios del equipo',
    'estado', case when n_oper = 0 then 'falta' when n_jefes = 0 then 'aviso' else 'ok' end,
    'valor', n_oper || ' persona(s) registran en ' || lower(p_area::text),
    'detalle', case when n_oper = 0 then 'Crea los usuarios del equipo en Usuarios: cada quien entra con el suyo.'
                    when n_jefes = 0 then 'No hay ' || case when p_area = 'BAR' then 'jefe de barra' else 'chef' end
                                          || ': el conteo inicial y las anulaciones los hace entonces administración.' end);

  -- conteo inicial por zona
  select count(*), count(*) filter (where exists (select 1 from public.conteos c where c.ubicacion = u.codigo and c.tipo = 'INICIAL')),
         array_agg(u.nombre order by u.nombre) filter (where not exists (select 1 from public.conteos c where c.ubicacion = u.codigo and c.tipo = 'INICIAL'))
    into n_zonas, n_zonas_ini, v_zonas_sin
    from public.ubicaciones u where u.area = p_area and u.activo;
  select count(*), count(*) filter (where exists (select 1 from public.movimientos m where m.producto_id = p.id))
    into n_prod, n_kardex
    from public.productos p join public.genericos g on g.id = p.generico_id
   where p.activo and g.activo and g.area = p_area and g.tipo in ('MPe', 'MPI');
  v := v || jsonb_build_object('clave', 'conteo_inicial', 'titulo', 'Conteo inicial por zona',
    'estado', case when n_zonas_ini = 0 then 'falta' when n_zonas_ini < n_zonas then 'aviso' else 'ok' end,
    'valor', n_zonas_ini || ' de ' || n_zonas || ' zona(s) · ' || n_kardex || ' de ' || n_prod || ' productos con kardex',
    'detalle', case when n_zonas_ini < n_zonas then 'El conteo inicial abre el kardex con su costo: sin él, recibir, producir y dar de baja no tienen de dónde partir. Hazlo el día de arranque, antes de abrir.' end,
    'ejemplos', to_jsonb(coalesce(v_zonas_sin, '{}')));

  -- productos que entrarían al conteo inicial sin costo (ni de referencia ni de una compra)
  select count(*), (array_agg(g.nombre || coalesce(nullif(' · ' || p.marca, ' · '), '') order by p.clase_abc nulls last, g.nombre))[1:8]
    into n_sin_costo, v_sin_costo
    from public.productos p join public.genericos g on g.id = p.generico_id
    left join public.costos_producto cp on cp.producto_id = p.id
   where p.activo and g.activo and g.area = p_area and g.tipo = 'MPe'
     and not exists (select 1 from public.costos_referencia cr where cr.producto_id = p.id)
     and cp.costo_promedio is null;
  v := v || jsonb_build_object('clave', 'sin_costo', 'titulo', 'Insumos sin costo de partida',
    'estado', case when n_sin_costo = 0 then 'ok' else 'aviso' end,
    'valor', n_sin_costo || ' insumo(s)',
    'detalle', case when n_sin_costo > 0 then 'Entran al conteo inicial sin valor: su costo lo fija la primera compra que se reciba. Mientras tanto, lo que se produzca con ellos queda sin costo completo.' end,
    'ejemplos', to_jsonb(coalesce(v_sin_costo, '{}')));

  -- botellas abiertas que no se pueden contar por peso
  if p_area = 'BAR' then
    select count(*), (array_agg(g.nombre || coalesce(nullif(' · ' || p.marca, ' · '), '') order by g.nombre))[1:8]
      into n_taras, v_taras
      from public.taras t join public.productos p on p.id = t.producto_id join public.genericos g on g.id = p.generico_id
     where t.tara_g is null and p.activo and g.activo;
    v := v || jsonb_build_object('clave', 'taras', 'titulo', 'Botellas sin peso de tara',
      'estado', case when n_taras = 0 then 'ok' else 'aviso' end,
      'valor', n_taras || ' botella(s)',
      'detalle', case when n_taras > 0 then 'Sin el peso de la botella vacía, la botella abierta no se puede contar pesándola: hay que estimarla en ml. Pesa una vacía de cada una.' end,
      'ejemplos', to_jsonb(coalesce(v_taras, '{}')));
  end if;

  -- catálogo por depurar
  select count(*) into n_prov from public.productos p join public.genericos g on g.id = p.generico_id
   where p.activo and g.area = p_area and p.estado = 'PROVISIONAL';
  v := v || jsonb_build_object('clave', 'provisionales', 'titulo', 'Productos provisionales sin validar',
    'estado', case when n_prov = 0 then 'ok' else 'aviso' end, 'valor', n_prov || ' producto(s)',
    'detalle', case when n_prov > 0 then 'Se pueden recibir y contar, pero conviene validarlos para que su nombre, presentación y contenido estén bien antes del conteo inicial.' end);
  select count(*) into n_pares from public.revision_catalogo r where r.area = p_area and r.decision is null;
  v := v || jsonb_build_object('clave', 'pares', 'titulo', 'Posibles duplicados por revisar',
    'estado', case when n_pares = 0 then 'ok' else 'aviso' end, 'valor', n_pares || ' par(es)',
    'detalle', case when n_pares > 0 then 'Si dos productos son el mismo, únelos antes del conteo inicial: después, el que tenga saldo ya no se puede unir.' end);

  -- fichas de MPI que no se pueden usar completas al producir
  select count(distinct f.id), (array_agg(distinct f.codigo || ' ' || g.nombre))[1:8]
    into n_fichas_mal, v_fichas
    from public.fichas f join public.genericos g on g.id = f.generico_id
    cross join lateral public.costo_ficha(f.id) c
   where g.area = p_area and g.tipo = 'MPI' and (f.vigente_hasta is null or f.vigente_hasta >= privado.hoy())
     and (c.falta like 'La ficha no trae cantidad%' or c.falta like 'Falta la conversión%');
  select count(*) into n_mpi_sin_ficha from public.genericos g
   where g.area = p_area and g.tipo = 'MPI' and g.activo
     and not exists (select 1 from public.fichas f where f.generico_id = g.id and (f.vigente_hasta is null or f.vigente_hasta >= privado.hoy()));
  v := v || jsonb_build_object('clave', 'fichas', 'titulo', 'Fichas de producción',
    'estado', case when n_fichas_mal = 0 and n_mpi_sin_ficha = 0 then 'ok' else 'aviso' end,
    'valor', n_fichas_mal || ' ficha(s) incompletas · ' || n_mpi_sin_ficha || ' MPI sin ficha',
    'detalle', case when n_fichas_mal > 0 or n_mpi_sin_ficha > 0 then 'Se puede producir igual: los ingredientes que la ficha no trae o no puede convertir se escriben a mano en g o ml.' end,
    'ejemplos', to_jsonb(coalesce(v_fichas, '{}')));

  -- recepción
  select count(*) into n_proveedores from public.proveedores where activo;
  v := v || jsonb_build_object('clave', 'proveedores', 'titulo', 'Proveedores', 'estado', case when n_proveedores > 0 then 'ok' else 'falta' end,
    'valor', n_proveedores || ' activo(s)');
  if p_area = 'COCINA' then
    select count(*) into n_frio from public.genericos g
     where g.area = 'COCINA' and g.activo and g.tipo = 'MPe' and g.conservacion is null;
    v := v || jsonb_build_object('clave', 'frio', 'titulo', 'Insumos sin régimen de conservación',
      'estado', case when n_frio = 0 then 'ok' else 'aviso' end, 'valor', n_frio || ' insumo(s)',
      'detalle', case when n_frio > 0 then 'La recepción no les pide temperatura ni vencimiento de refrigerado. No impide arrancar.' end);
  end if;

  return v;
end
$$;

revoke execute on function public.estado_arranque(public.area_app) from public, anon;
grant execute on function public.estado_arranque(public.area_app) to authenticated;
