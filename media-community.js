const mainContent = document.querySelector('main > div.max-w-7xl');

if (mainContent) {
    const mediaSection = document.createElement('section');
    mediaSection.id = 'media-hub';
    mediaSection.className = 'space-y-10 mb-16';
    mediaSection.innerHTML = `
        <section class="glass-card rounded-[2rem] border border-white/10 p-8">
            <p class="text-xs uppercase tracking-[0.3em] text-brand-accent font-semibold">Media &amp; Community</p>
            <h2 class="mt-3 text-4xl font-bold text-white">Podcast, streaming, and editorial channels</h2>
            <div class="mt-6 grid gap-4 md:grid-cols-2">
                <article class="rounded-3xl border border-white/10 bg-brand-charcoal/90 p-5"><div class="text-sm font-semibold text-white">HighRants Podcast</div><p class="mt-2 text-sm leading-6 text-slate-300">Operational commentary and scientific analysis from the front lines of cannabis and hemp media.</p><a href="https://open.spotify.com/show/1GNkMNkas8x9SROFkCxBtB" target="_blank" rel="noreferrer noopener" class="mt-4 inline-flex text-sm font-semibold text-brand-accent">Listen on Spotify</a></article>
                <article class="rounded-3xl border border-white/10 bg-brand-charcoal/90 p-5"><div class="text-sm font-semibold text-white">YouTube Channel</div><p class="mt-2 text-sm leading-6 text-slate-300">Editorial deep dives, regulatory updates, and clinical trend breakdowns.</p><a href="https://www.youtube.com/@TokenHaven" target="_blank" rel="noreferrer noopener" class="mt-4 inline-flex text-sm font-semibold text-brand-accent">Watch Channel</a></article>
            </div>
        </section>
        `;
    mainContent.insertBefore(mediaSection, mainContent.firstElementChild);

    const roomHeading = [...mainContent.querySelectorAll('h1')].find(heading => heading.textContent.includes('Community Room'));
    roomHeading?.closest('section')?.setAttribute('id', 'community-room');

    lucide.createIcons();
}
