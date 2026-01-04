'use client';

import { WebsiteStatus } from './IngestionForm';

interface StatusDisplayProps {
  status: WebsiteStatus;
  onIngest: () => void;
  onIndexing?: (websiteId: string) => void;
  onReset: () => void;
  isPending: boolean;
}

export function StatusDisplay({ status, onIngest, onIndexing, onReset, isPending }: StatusDisplayProps) {
  if (status.type === 'idle') {
    return null;
  }

  if (status.type === 'checking') {
    return (
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-xl p-6 shadow-sm animate-pulse">
        <div className="flex items-center space-x-4">
          <div className="relative">
            <div className="animate-spin rounded-full h-8 w-8 border-3 border-blue-200 border-t-blue-600"></div>
            <div className="absolute inset-0 rounded-full border-3 border-transparent border-t-blue-400 animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }}></div>
          </div>
          <div>
            <p className="text-blue-900 font-semibold text-base">Checking if website exists...</p>
            <p className="text-blue-600 text-sm mt-0.5">This will only take a moment</p>
          </div>
        </div>
      </div>
    );
  }

  if (status.type === 'exists') {
    return (
      <div className="bg-gradient-to-br from-amber-50 to-yellow-50 border-2 border-amber-200 rounded-xl p-6 shadow-lg animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex items-start space-x-4">
          <div className="flex-shrink-0">
            <div className="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center">
              <svg className="h-7 w-7 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-xl font-bold text-amber-900 mb-3">
              Website Already Exists
            </h3>
            <div className="bg-white/60 rounded-lg p-4 mb-4 space-y-2.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-amber-900">Root Domain:</span>
                <span className="text-sm text-amber-800 font-mono bg-amber-100 px-2 py-1 rounded">{status.domain}</span>
              </div>
              <p className="text-xs text-amber-700 italic">
                Resolved to root domain from the URL you provided
              </p>
              {status.website?.display_name && (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-amber-900">Display Name:</span>
                  <span className="text-sm text-amber-800">{status.website.display_name}</span>
                </div>
              )}
              {status.website?.id && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-amber-900">Website ID:</span>
                  <code className="text-xs bg-amber-100 text-amber-900 px-2 py-1 rounded font-mono">{status.website.id}</code>
                </div>
              )}
            </div>
            <p className="text-sm text-amber-800 mb-5 leading-relaxed">
              This website has already been processed in the system. You can chat with it or run the sync service to check for changes.
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => {
                  // UI only - no server action implemented yet
                  alert('Sync service integration coming soon. This will check for changes and update the website.');
                }}
                className="bg-gradient-to-r from-amber-500 to-amber-600 text-white py-2.5 px-6 rounded-xl font-semibold hover:from-amber-600 hover:to-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 transition-all duration-200 shadow-md hover:shadow-lg transform hover:scale-[1.02]"
              >
                Run Sync Service
              </button>
              <button
                onClick={onReset}
                className="bg-gray-600 text-white py-2.5 px-6 rounded-xl font-semibold hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-all duration-200 shadow-md hover:shadow-lg transform hover:scale-[1.02]"
              >
                Check Another Website
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (status.type === 'new') {
    return (
      <div className="bg-gradient-to-br from-emerald-50 to-green-50 border-2 border-emerald-200 rounded-xl p-6 shadow-lg animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex items-start space-x-4">
          <div className="flex-shrink-0">
            <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center">
              <svg className="h-7 w-7 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-xl font-bold text-emerald-900 mb-2">
              New Website Detected
            </h3>
            <div className="mb-4">
              <span className="text-sm text-emerald-700">Domain: </span>
              <span className="text-sm font-mono font-semibold text-emerald-900 bg-emerald-100 px-2 py-1 rounded">{status.domain}</span>
            </div>
            <div className="bg-white/70 border border-emerald-200 rounded-lg p-4 mb-5">
              <p className="text-sm font-semibold text-emerald-900 mb-3 flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                What will happen:
              </p>
              <ul className="text-sm text-emerald-800 space-y-2 ml-6 list-disc">
                <li>Create a new website record in the system</li>
                <li>Discover all URLs on the website</li>
                <li>Scrape and store content as markdown</li>
                <li>Create records for all discovered pages</li>
              </ul>
            </div>
            <p className="text-sm text-emerald-800 mb-5 leading-relaxed">
              This is a new website we have detected. Do you want to run the ingestion?
            </p>
            <button
              onClick={onIngest}
              disabled={isPending}
              className="bg-gradient-to-r from-emerald-500 to-green-600 text-white py-3 px-8 rounded-xl font-semibold hover:from-emerald-600 hover:to-green-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:from-gray-400 disabled:to-gray-400 disabled:cursor-not-allowed transition-all duration-200 shadow-lg hover:shadow-xl disabled:shadow-none transform hover:scale-[1.02] disabled:transform-none"
            >
              {isPending ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Starting Ingestion...
                </span>
              ) : (
                'Run Ingestion'
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (status.type === 'ingesting') {
    const progressPercentage = status.progress?.percentage ?? 0;
    const completed = status.progress?.completed ?? 0;
    const total = status.progress?.total ?? 0;
    
    return (
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-xl p-6 shadow-lg">
        <div className="flex items-start space-x-4">
          <div className="flex-shrink-0">
            <div className="relative">
              <div className="animate-spin rounded-full h-10 w-10 border-3 border-blue-200 border-t-blue-600"></div>
              <div className="absolute inset-0 rounded-full border-3 border-transparent border-t-blue-400 animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }}></div>
            </div>
          </div>
          <div className="flex-1">
            <h3 className="text-xl font-bold text-blue-900 mb-2">
              Ingestion in Progress
            </h3>
            <p className="text-sm text-blue-800 mb-4 leading-relaxed">
              This may take several minutes. The website is being crawled, scraped, and pages are being stored...
            </p>
            {total > 0 && (
              <div className="mb-2">
                <div className="flex justify-between text-xs text-blue-700 mb-1">
                  <span>Scraping pages...</span>
                  <span>{completed} / {total} ({progressPercentage}%)</span>
                </div>
                <div className="mt-2 bg-blue-100 rounded-full h-3 overflow-hidden shadow-inner">
                  <div 
                    className="bg-gradient-to-r from-blue-500 to-blue-600 h-3 rounded-full shadow-md transition-all duration-500" 
                    style={{ width: `${Math.max(5, progressPercentage)}%` }}
                  ></div>
                </div>
              </div>
            )}
            {total === 0 && (
              <div className="mt-4 bg-blue-100 rounded-full h-3 overflow-hidden shadow-inner">
                <div className="bg-gradient-to-r from-blue-500 to-blue-600 h-3 rounded-full animate-pulse shadow-md" style={{ width: '30%' }}></div>
              </div>
            )}
            <p className="text-xs text-blue-600 mt-2 italic">Please don't close this page</p>
          </div>
        </div>
      </div>
    );
  }

  if (status.type === 'ingested') {
    return (
      <div className="bg-gradient-to-br from-emerald-50 to-green-50 border-2 border-emerald-200 rounded-xl p-6 shadow-lg animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex items-start space-x-4">
          <div className="flex-shrink-0">
            <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center">
              <svg className="h-7 w-7 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-xl font-bold text-emerald-900 mb-4">
              Ingestion Completed Successfully! 🎉
            </h3>
            <div className="bg-white/70 rounded-lg p-4 mb-5 space-y-2.5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">Website ID</span>
                  <p className="text-sm font-mono text-emerald-900 mt-1 bg-emerald-100 px-2 py-1 rounded">{status.result.websiteId}</p>
                </div>
                <div>
                  <span className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">Domain</span>
                  <p className="text-sm text-emerald-900 mt-1 font-semibold">{status.result.domain}</p>
                </div>
                <div>
                  <span className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">Pages Discovered</span>
                  <p className="text-2xl font-bold text-emerald-900 mt-1">{status.result.pagesDiscovered}</p>
                </div>
                <div>
                  <span className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">Pages Scraped</span>
                  <p className="text-2xl font-bold text-emerald-900 mt-1">{status.result.pagesIndexed}</p>
                </div>
              </div>
              {status.result.errors && status.result.errors.length > 0 && (
                <div className="pt-2 border-t border-emerald-200">
                  <p className="text-xs text-amber-700"><strong>Errors:</strong> {status.result.errors.length}</p>
                </div>
              )}
            </div>
            <p className="text-sm text-emerald-800 mb-5 leading-relaxed">
              The website has been ingested and pages have been scraped. Now you can run indexing to upload the content to Gemini File Search.
            </p>
            <div className="flex flex-wrap gap-3">
              {onIndexing && status.result && status.result.pagesIndexed > 0 && (
                <button
                  onClick={() => onIndexing(status.websiteId)}
                  disabled={isPending}
                  className="bg-gradient-to-r from-blue-500 to-blue-600 text-white py-3 px-8 rounded-xl font-semibold hover:from-blue-600 hover:to-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:from-gray-400 disabled:to-gray-400 disabled:cursor-not-allowed transition-all duration-200 shadow-lg hover:shadow-xl disabled:shadow-none transform hover:scale-[1.02] disabled:transform-none"
                >
                  {isPending ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Starting Indexing...
                    </span>
                  ) : (
                    'Run Indexing'
                  )}
                </button>
              )}
              <button
                onClick={onReset}
                className="bg-gray-600 text-white py-3 px-6 rounded-xl font-semibold hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-all duration-200 shadow-md hover:shadow-lg transform hover:scale-[1.02]"
              >
                Ingest Another Website
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (status.type === 'indexing') {
    return (
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-xl p-6 shadow-lg">
        <div className="flex items-start space-x-4">
          <div className="flex-shrink-0">
            <div className="relative">
              <div className="animate-spin rounded-full h-10 w-10 border-3 border-blue-200 border-t-blue-600"></div>
              <div className="absolute inset-0 rounded-full border-3 border-transparent border-t-blue-400 animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }}></div>
            </div>
          </div>
          <div className="flex-1">
            <h3 className="text-xl font-bold text-blue-900 mb-2">
              Indexing in Progress
            </h3>
            <p className="text-sm text-blue-800 mb-4 leading-relaxed">
              Uploading scraped content to Gemini File Search. This may take several minutes depending on the number of pages...
            </p>
            <div className="mt-4 bg-blue-100 rounded-full h-3 overflow-hidden shadow-inner">
              <div className="bg-gradient-to-r from-blue-500 to-blue-600 h-3 rounded-full animate-pulse shadow-md" style={{ width: '70%' }}></div>
            </div>
            <p className="text-xs text-blue-600 mt-2 italic">Please don't close this page</p>
          </div>
        </div>
      </div>
    );
  }

  if (status.type === 'indexed') {
    return (
      <div className="bg-gradient-to-br from-emerald-50 to-green-50 border-2 border-emerald-200 rounded-xl p-6 shadow-lg animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex items-start space-x-4">
          <div className="flex-shrink-0">
            <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center">
              <svg className="h-7 w-7 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-xl font-bold text-emerald-900 mb-4">
              Indexing Completed Successfully! 🚀
            </h3>
            <div className="bg-white/70 rounded-lg p-4 mb-5">
              <div className="flex items-baseline gap-2 mb-2">
                <span className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">Pages Indexed</span>
                <span className="text-3xl font-bold text-emerald-900">{status.result.pagesIndexed}</span>
              </div>
              {status.result.errors && status.result.errors.length > 0 && (
                <div className="pt-2 border-t border-emerald-200">
                  <p className="text-xs text-amber-700"><strong>Errors:</strong> {status.result.errors.length}</p>
                </div>
              )}
            </div>
            <p className="text-sm text-emerald-800 mb-5 leading-relaxed">
              All pages have been uploaded to Gemini File Search and are now searchable. You can now chat with this website!
            </p>
            <button
              onClick={onReset}
              className="bg-gradient-to-r from-emerald-500 to-green-600 text-white py-3 px-8 rounded-xl font-semibold hover:from-emerald-600 hover:to-green-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 transition-all duration-200 shadow-lg hover:shadow-xl transform hover:scale-[1.02]"
            >
              Ingest Another Website
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (status.type === 'error') {
    return (
      <div className="bg-gradient-to-br from-red-50 to-rose-50 border-2 border-red-200 rounded-xl p-6 shadow-lg animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex items-start space-x-4">
          <div className="flex-shrink-0">
            <div className="w-12 h-12 bg-red-100 rounded-xl flex items-center justify-center">
              <svg className="h-7 w-7 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-xl font-bold text-red-900 mb-3">
              Error Occurred
            </h3>
            <div className="bg-white/70 rounded-lg p-4 mb-5">
              <p className="text-sm text-red-800 leading-relaxed font-medium">
                {status.message}
              </p>
            </div>
            <button
              onClick={onReset}
              className="bg-gradient-to-r from-red-500 to-red-600 text-white py-3 px-8 rounded-xl font-semibold hover:from-red-600 hover:to-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-all duration-200 shadow-lg hover:shadow-xl transform hover:scale-[1.02]"
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

