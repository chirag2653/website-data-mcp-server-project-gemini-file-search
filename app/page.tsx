import { IngestionForm } from './components/IngestionForm';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-2xl shadow-xl p-8 sm:p-10 border border-gray-100">
          <div className="mb-10">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg">
                <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div>
                <h1 className="text-3xl sm:text-4xl font-bold text-gray-900">
                  Website Ingestion Service
                </h1>
                <p className="text-gray-500 text-sm mt-1">Powered by Gemini File Search</p>
              </div>
            </div>
            <p className="text-gray-600 text-lg leading-relaxed">
              Enter a website URL to check if it's already processed or start a new ingestion. The system will automatically discover, scrape, and index all pages.
            </p>
          </div>
          
          <IngestionForm />
        </div>
      </div>
    </div>
  );
}

