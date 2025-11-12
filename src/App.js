// --- Constantes de la API ---

// AHORA usas la URL de tu Cloudflare Worker
// (La obtienes después de desplegar tu Worker. Ej: https://www.google.com/search?q=https://proxy-gemini.tu-cuenta.workers.dev)
const apiUrl = "proxy-gemini.mariajesuscresci.workers.dev"; // <-- RECUERDA PEGAR TU URL REAL AQUÍ

// --- Instrucción del Sistema (El "Cerebro" del Asistente) ---
// Define la personalidad y el flujo de trabajo del chatbot.
const systemInstruction = {
parts: [{
text: `
Eres un "Net-Troubleshooter", un ingeniero experto en redes (nivel CCIE/JNCIE) con un enfoque metódico y colaborativo.
Tu único objetivo es guiar a un usuario paso a paso para diagnosticar un problema de red en su "red objetivo".

TU FLUJO DE TRABAJO:

Empezar: Siempre empiezas pidiendo al usuario que describa el síntoma del problema (ej. "No puedo hacer ping a 8.8.8.8", "El servidor web es inaccesible").

Diagnóstico Metódico (Modelo OSI): Basa tu diagnóstico en el modelo OSI. Empieza por la Capa 1/2 (¿Hay enlace?), luego Capa 3 (¿Hay IP, hay ruta?) y así sucesivamente.

UNA PREGUNTA A LA VEZ: Esta es tu regla más importante. NUNCA hagas múltiples preguntas. Haz una sola pregunta o pide un solo comando.

Pedir Comandos: Pide al usuario que ejecute comandos específicos (ej. "Por favor, ejecuta 'ping 192.168.1.1' y pégamela salida", "Muéstrame la salida de 'ipconfig /all'", "Ejecuta un 'traceroute 8.8.8.8'").

Analizar y Repetir: El usuario te dará la salida del comando. Analízala y luego decide cuál es la siguiente pregunta lógica o el siguiente comando a ejecutar.

Concluir: Una vez que tengas suficiente información, proporciona un diagnóstico claro de la causa raíz probable y sugiere una solución o mitigación.

Manejo de Archivos: El usuario puede subir o pegar archivos de configuración (.txt, .log) o salidas de Ansible. Cuando veas un bloque de texto que parezca una configuración de red o un log, úsalo como contexto principal para tu siguiente pregunta de diagnóstico. Analiza el archivo en busca de problemas obvios (ej. IPs incorrectAS, ACLs, rutas faltantes) antes de continuar.

Tono: Profesional, técnico, pero amigable. Eres un colega senior ayudando.
`
}]
};

// --- Componente de Mensaje del Chat ---
const ChatMessage = ({ message }) => {
const isModel = message.role === 'model';
return (
<div className={flex ${isModel ? 'justify-start' : 'justify-end'} mb-4}>
<div
className={rounded-lg px-4 py-3 max-w-lg ${ isModel ? 'bg-gray-100 text-gray-800' : 'bg-blue-500 text-white' }}
>
{/* Renderizar el texto, manejando saltos de línea */}
{message.parts[0].text.split('\n').map((line, index) => (
<p key={index}>{line}</p>
))}
</div>
</div>
);
};

// --- Componente Principal de la Aplicación ---
export default function App() {
// --- Estado ---
const [chatHistory, setChatHistory] = useState([
// Mensaje inicial del asistente
{
role: 'model',
parts: [{ text: "Hola, soy Net-Troubleshooter. Estoy aquí para ayudarte a diagnosticar tu problema de red. \n\nPor favor, describe el problema que estás experimentando (ej. 'No puedo acceder al servidor X', 'Internet está lento')." }]
}
]);
const [userInput, setUserInput] = useState('');
const [isLoading, setIsLoading] = useState(false);
const [error, setError] = useState(null);

// Referencia para auto-scroll
const chatEndRef = useRef(null);
// Referencia para el input de archivo
const fileInputRef = useRef(null);

// --- Efectos ---
// Auto-scroll al final del chat cuando llegan nuevos mensajes
useEffect(() => {
chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
}, [chatHistory]);

// --- Funciones ---

/**

Envía el mensaje del usuario y obtiene la respuesta del modelo.
*/
const handleSendMessage = async () => {
if (!userInput.trim()) return;

setIsLoading(true);
setError(null);

// Nuevo mensaje del usuario
const newUserMessage = {
  role: 'user',
  parts: [{ text: userInput }]
};

// Historial actualizado para la UI y la API
const updatedHistory = [...chatHistory, newUserMessage];
setChatHistory(updatedHistory);
setUserInput('');

// --- Llamada a la API de Gemini ---
try {
  // Usamos 'Retries' (reintentos) con backoff exponencial
  const response = await fetchWithRetries(apiUrl, { // 'apiUrl' es ahora tu API Gateway
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      // El backend de Lambda debe estar programado para aceptar esta estructura
      contents: updatedHistory, 
      systemInstruction: systemInstruction, 
    }),
  });

  if (!response.ok) {
    throw new Error(`Error de API: ${response.statusText} (Status: ${response.status})`);
  }

  const result = await response.json();

  // IMPORTANTE: Tu Lambda debe devolver la respuesta de Google
  // en la misma estructura que la app espera.
  if (result.candidates && result.candidates.length > 0) {
    const modelResponse = result.candidates[0].content;
    setChatHistory(prevHistory => [...prevHistory, modelResponse]);
  } else {
    // Manejar el caso donde no hay 'candidates' (ej. error de seguridad de la API)
    if (result.error) {
       throw new Error(`Error de la API de Google: ${result.error.message}`);
    } else {
       throw new Error("Respuesta de API inesperada o vacía.");
    }
  }

} catch (err) {
  console.error(err);
  setError(`Error al contactar al asistente. (Detalle: ${err.message}). Por favor, intenta de nuevo.`);
  // Revertir el historial si la API falla (opcional, pero bueno para la UX)
  // setChatHistory(chatHistory); 
} finally {
  setIsLoading(false);
}


};

/**

Maneja la subida de un archivo de configuración.
*/
const handleFileUpload = (event) => {
const file = event.target.files?.[0];
if (!file) return;

// Validar tipo
if (!file.type.startsWith('text/')) {
  setError("Por favor, sube solo archivos de texto (.txt, .log, .conf).");
  return;
}

const reader = new FileReader();
reader.onload = (e) => {
  const fileContent = e.target?.result;
  if (typeof fileContent === 'string') {
    // Pone el contenido del archivo en el textarea para que el usuario lo revise y envíe
    setUserInput(prevInput => 
      `${prevInput}\n\nHe subido este archivo para tu análisis (${file.name}):\n--- INICIO DEL ARCHIVO ---\n${fileContent}\n--- FIN DEL ARCHIVO ---`
    );
    setError(null); // Limpiar error si la subida fue exitosa
  } else {
    setError("Error al leer el contenido del archivo.");
  }
};
reader.onerror = () => {
  setError("Error al leer el archivo.");
};
reader.readAsText(file);

// Resetear el input para permitir subir el mismo archivo de nuevo
event.target.value = '';


};

/**

Wrapper de Fetch con reintentos y backoff exponencial.

Esto previene fallos por throttling (limitación de tasa).
*/
const fetchWithRetries = async (url, options, retries = 3, delay = 1000) => {
try {
const response = await fetch(url, options);
if (!response.ok && response.status === 429 && retries > 0) { // 429 = Too Many Requests
// No loguear reintentos en consola
await new Promise(resolve => setTimeout(resolve, delay));
return fetchWithRetries(url, options, retries - 1, delay * 2); // Duplicar el delay
}
return response;
} catch (e) {
if (retries > 0) {
await new Promise(resolve => setTimeout(resolve, delay));
return fetchWithRetries(url, options, retries - 1, delay * 2);
}
throw e;
}
};

/**

Maneja el envío con la tecla Enter.
*/
const handleKeyDown = (e) => {
if (e.key === 'Enter' && !e.shiftKey && !isLoading) {
e.preventDefault();
handleSendMessage();
}
};

// --- Renderizado ---
return (
<div className="flex flex-col h-screen bg-gray-50 font-sans">
{/* Encabezado */}
<header className="bg-white shadow-md p-4 border-b border-gray-200">
<h1 className="text-xl font-semibold text-gray-800 text-center">
Asistente de Troubleshooting de Red
</h1>
</header>

  {/* Área de Chat */}
  <main className="flex-grow p-4 overflow-y-auto space-y-4">
    {chatHistory.map((msg, index) => (
      <ChatMessage key={index} message={msg} />
    ))}
    {/* Referencia para auto-scroll */}
    <div ref={chatEndRef} />
  </main>

  {/* Mensaje de Error */}
  {error && (
    <div className="p-4 text-center text-red-600 bg-red-100 border-t border-red-200">
      {error}
    </div>
  )}

  {/* Área de Input */}
  <footer className="bg-white p-4 border-t border-gray-200">
    <div className="flex items-center space-x-3 max-w-3xl mx-auto">
      {/* Input de archivo oculto */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        className="hidden"
        accept=".txt,.log,.conf,.text"
      />
      {/* Botón para subir archivo (Clip) */}
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={isLoading}
        className="p-3 text-gray-500 hover:text-blue-600 focus:outline-none disabled:text-gray-300"
        title="Subir archivo de configuración"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.49"></path>
        </svg>
      </button>
      
      <textarea
        className="flex-grow p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 resize-none"
        rows="2"
        placeholder={isLoading ? "El asistente está respondiendo..." : "Escribe la salida del comando o tu respuesta..."}
        value={userInput}
        onChange={(e) => setUserInput(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={isLoading}
      />
      <button
        onClick={handleSendMessage}
        disabled={isLoading}
        className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-blue-300 disabled:cursor-not-allowed"
      >
        {isLoading ? (
          // Spinner simple
          <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        ) : (
          'Enviar'
        )}
      </button>
    </div>
  </footer>
</div>


);
}