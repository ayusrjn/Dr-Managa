import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Modality } from '@google/genai';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

interface PanelScript {
  panel: number;
  description: string;
  dialogue: string;
  sfx?: string;
}

interface MangaPanelData extends PanelScript {
  imageUrl: string | null;
}

/**
 * Parses a text-based script into a structured array of panel data.
 * @param scriptText The raw text output from the model.
 * @returns An array of PanelScript objects.
 */
const parseScript = (scriptText: string): PanelScript[] => {
  const panels: PanelScript[] = [];
  // Use a positive lookahead to split the text by "Panel X:" while keeping the delimiter.
  const panelBlocks = scriptText.split(/(?=Panel \d+:)/).filter(block => block.trim() !== '');

  if (panelBlocks.length === 0) {
      throw new Error("Script parsing failed: Could not find any panels in the generated text.");
  }
  
  panelBlocks.forEach((block) => {
    const panelNumMatch = block.match(/^Panel (\d+):/im);
    const panelNum = panelNumMatch ? parseInt(panelNumMatch[1], 10) : 0;
    
    const descriptionMatch = block.match(/Description:\s*([\s\S]*?)(?=Dialogue:|SFX:|$)/i);
    const dialogueMatch = block.match(/Dialogue:\s*([\s\S]*?)(?=SFX:|$)/i);
    const sfxMatch = block.match(/SFX:\s*([\s\S]*?)$/i);

    if (panelNum > 0) {
        panels.push({
            panel: panelNum,
            description: descriptionMatch ? descriptionMatch[1].trim() : 'No description provided.',
            dialogue: dialogueMatch ? dialogueMatch[1].trim() : '',
            sfx: (sfxMatch && sfxMatch[1].trim()) ? sfxMatch[1].trim() : undefined,
        });
    }
  });

  if (panels.length === 0) {
      throw new Error("Script parsing failed: Found panel blocks but could not extract panel data.");
  }

  // Ensure panels are in the correct order.
  return panels.sort((a,b) => a.panel - b.panel);
};


const App: React.FC = () => {
  const [topic, setTopic] = useState<string>('');
  const [mangaPanels, setMangaPanels] = useState<MangaPanelData[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isDownloading, setIsDownloading] = useState<boolean>(false);
  const [loadingMessage, setLoadingMessage] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
  const presetTopics = ["Photosynthesis", "Black Holes", "The Water Cycle", "Volcanoes"];

  const handleGenerateManga = async (topicOverride?: string) => {
    const currentTopic = topicOverride || topic;
    if (!currentTopic.trim()) {
      setError('Please enter a science topic.');
      return;
    }
    setIsLoading(true);
    setError(null);
    setMangaPanels([]);

    try {
      // Step 1: Generate the script
      setLoadingMessage('Dr. Manga is drafting the story...');
      const systemInstruction = "You are a manga writer creating a script for 'MangaScience', an educational comic for kids aged 8-12. Your task is to create a fun but scientifically accurate script. Use the recurring characters: Dr. Manga (a friendly scientist), Kiko (a curious child), and Momo (a funny floating mascot). The style should be a light-hearted, shōnen manga tone with simple words. The output must be a script with exactly 6 panels. Each panel must start with 'Panel X:' on a new line and contain 'Description:', 'Dialogue:', and optional 'SFX:' sections. The final panel must end with a mini moral or a quiz question.";
      const scriptPrompt = `Explain the scientific concept of: ${currentTopic}.`;

      const scriptResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: scriptPrompt,
        config: {
          systemInstruction: systemInstruction,
        },
      });
      
      const scriptData = parseScript(scriptResponse.text.trim());

      if (!scriptData || scriptData.length < 4) {
        throw new Error('Failed to generate a valid script with at least 4 panels.');
      }
      
      const initialPanels = scriptData
        .map(script => ({ ...script, imageUrl: null }));
      setMangaPanels(initialPanels);

      // Step 2: Generate images for each panel
      for (let i = 0; i < scriptData.length; i++) {
        setLoadingMessage(`Inking panel ${i + 1} of ${scriptData.length}...`);
        const panel = scriptData[i];
        
        const imagePrompt = `You are generating educational manga panels in black-and-white shōnen manga style. Your task is to generate Panel ${panel.panel} of a ${scriptData.length}-panel comic.

Characters to include: Dr. Manga (wise scientist), Kiko (curious child), and Momo (funny mascot). Keep their designs consistent.

For this specific panel (Panel ${panel.panel}):
- Scene Description: ${panel.description}
- Dialogue to include: "${panel.dialogue}"
- Sound Effect (SFX) to include: ${panel.sfx ? `"${panel.sfx}"` : 'None'}

Instructions:
- Draw the scene based on the description.
- Integrate all dialogue and SFX directly inside the manga panel as proper speech bubbles, thought bubbles, or text effects.
- The picture must look like a finished manga panel where the characters are speaking inside the artwork.
- Do not output dialogue or SFX as plain text outside the image.
- Keep the art clean, high-contrast, and easy to read for kids.`;

        const imageResponse = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image-preview',
            contents: { parts: [{ text: imagePrompt }] },
            config: {
                responseModalities: [Modality.IMAGE, Modality.TEXT],
            },
        });

        let imageUrl: string | null = null;
        if (imageResponse.candidates && imageResponse.candidates[0].content.parts) {
            for (const part of imageResponse.candidates[0].content.parts) {
                if (part.inlineData) {
                    const base64ImageBytes: string = part.inlineData.data;
                    imageUrl = `data:image/png;base64,${base64ImageBytes}`;
                    break;
                }
            }
        }
        
        if (!imageUrl) {
            console.error(`Image generation failed for panel ${i + 1}`);
        }

        setMangaPanels(prevPanels => {
          const newPanels = [...prevPanels];
          newPanels[i].imageUrl = imageUrl;
          return newPanels;
        });
      }

      setLoadingMessage('');

    } catch (err) {
      console.error(err);
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
      setError(`An error occurred while generating the manga: ${errorMessage} Please try again.`);
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleReset = () => {
      setMangaPanels([]);
      setTopic('');
      setError(null);
  }

  const handleDownloadPdf = async () => {
    setIsDownloading(true);
    setError(null);

    try {
        const pdf = new jsPDF('p', 'mm', 'a4'); // A4 size page of PDF
        const panelElements = document.querySelectorAll<HTMLElement>('.manga-panel');
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = pdf.internal.pageSize.getHeight();

        for (let i = 0; i < panelElements.length; i++) {
            const panel = panelElements[i];
            const canvas = await html2canvas(panel, {
                scale: 2, // Increase scale for better quality
                useCORS: true,
                backgroundColor: null,
            });
            const imgData = canvas.toDataURL('image/png');

            // Calculate the aspect ratio to fit the image correctly in the PDF page
            const imgProps = pdf.getImageProperties(imgData);
            const aspectRatio = imgProps.width / imgProps.height;

            let imgWidth = pdfWidth - 20; // with some margin
            let imgHeight = imgWidth / aspectRatio;

            // If the image is too tall, scale it down based on height instead
            if (imgHeight > pdfHeight - 20) {
                imgHeight = pdfHeight - 20;
                imgWidth = imgHeight * aspectRatio;
            }

            const x = (pdfWidth - imgWidth) / 2;
            const y = (pdfHeight - imgHeight) / 2;

            if (i > 0) {
                pdf.addPage();
            }
            pdf.addImage(imgData, 'PNG', x, y, imgWidth, imgHeight);
        }
        pdf.save(`mangascience-${topic.replace(/\s+/g, '-').toLowerCase() || 'comic'}.pdf`);
    } catch (err) {
        console.error("Failed to create PDF:", err);
        setError("Sorry, there was an issue creating the PDF. Please try again.");
    } finally {
        setIsDownloading(false);
    }
  };

  const handlePresetClick = (presetTopic: string) => {
    setTopic(presetTopic);
    handleGenerateManga(presetTopic);
  };

  return (
    <>
      <main className="app-container">
        <header className="app-header">
          <h1>MangaScience</h1>
          <p className="description">
              Turn any science topic into a fun comic adventure! Just type a concept below and watch the magic happen.
          </p>
        </header>

        {mangaPanels.length === 0 && (
          <div className="form-container">
            <form
              className="topic-form"
              onSubmit={(e) => {
                  e.preventDefault();
                  handleGenerateManga();
              }}
            >
              <input
                  type="text"
                  className="topic-input"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="e.g., Photosynthesis, Gravity..."
                  aria-label="Science topic for manga"
                  disabled={isLoading}
              />
              <button
                  type="submit"
                  className="generate-button"
                  disabled={isLoading}
              >
                  {isLoading ? 'Creating...' : 'Create Comic!'}
              </button>
            </form>
            <div className="preset-topics-container">
              {presetTopics.map((preset) => (
                <button
                  key={preset}
                  className="preset-topic-button"
                  onClick={() => handlePresetClick(preset)}
                  disabled={isLoading}
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && <div className="error-container">{error}</div>}

        {isLoading && (
            <div className="loading-container">
            <div className="spinner"></div>
            <p>{loadingMessage}</p>
            </div>
        )}

        {mangaPanels.length > 0 && (
            <>
            <section className="manga-grid" aria-live="polite">
            {mangaPanels.map((panel) => (
                <article key={panel.panel} className="manga-panel">
                <div className="panel-image-container">
                    {panel.imageUrl ? (
                    <img src={panel.imageUrl} alt={panel.description} className="panel-image" />
                    ) : (
                    <div className="placeholder">
                        <div className="spinner"></div>
                        <span>Drawing...</span>
                    </div>
                    )}
                </div>
                </article>
            ))}
            </section>
            
            {!isLoading && (
                <div className="actions-container">
                    <button onClick={handleDownloadPdf} className="download-button" disabled={isDownloading}>
                        {isDownloading ? 'Downloading...' : 'Download as PDF'}
                    </button>
                    <button onClick={handleReset} className="generate-button">
                        Create Another Comic!
                    </button>
                </div>
            )}
            </>
        )}
      </main>
      <footer className="app-footer">
        <p>Made with ❤️ for science & manga fans.</p>
      </footer>
    </>
  );
};

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<App />);