// Va en el <head>: aplica el tema guardado en el equipo antes de pintar, para que no parpadee.
// «tema» lo elige la persona (claro, oscuro, auto); «tema-rol» es el defecto de su rol (components/Tema.tsx).
export const SCRIPT_TEMA = `(function(){try{var t=localStorage.getItem('tema')||localStorage.getItem('tema-rol');
if(t==='oscuro')document.documentElement.setAttribute('data-theme','dark');
else if(t==='claro')document.documentElement.setAttribute('data-theme','light');}catch(e){}})();`;
