const QUOTES: { text: string; author: string }[] = [
  { text: "The best way to predict the future is to invent it.", author: "Alan Kay" },
  { text: "Simplicity is the ultimate sophistication.", author: "Leonardo da Vinci" },
  { text: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
  { text: "Talk is cheap. Show me the code.", author: "Linus Torvalds" },
  { text: "In the middle of difficulty lies opportunity.", author: "Albert Einstein" },
  { text: "First, solve the problem. Then, write the code.", author: "John Johnson" },
  { text: "Stay hungry, stay foolish.", author: "Stewart Brand" },
  { text: "The computer was born to solve problems that did not exist before.", author: "Bill Gates" },
  { text: "Any sufficiently advanced technology is indistinguishable from magic.", author: "Arthur C. Clarke" },
  { text: "It does not matter how slowly you go as long as you do not stop.", author: "Confucius" },
  { text: "Imagination is more important than knowledge.", author: "Albert Einstein" },
  { text: "The secret of getting ahead is getting started.", author: "Mark Twain" },
  { text: "Whether you think you can, or you think you can't — you're right.", author: "Henry Ford" },
  { text: "Do what you can, with what you have, where you are.", author: "Theodore Roosevelt" },
  { text: "The best time to plant a tree was 20 years ago. The second best time is now.", author: "Chinese Proverb" },
  { text: "We are what we repeatedly do. Excellence, then, is not an act, but a habit.", author: "Aristotle" },
  { text: "Perfection is achieved not when there is nothing more to add, but when there is nothing left to take away.", author: "Antoine de Saint-Exupery" },
  { text: "Debugging is twice as hard as writing the code in the first place.", author: "Brian Kernighan" },
  { text: "Make it work, make it right, make it fast.", author: "Kent Beck" },
  { text: "The most dangerous phrase in the language is 'We've always done it this way.'", author: "Grace Hopper" },
  { text: "A ship in harbour is safe, but that is not what ships are built for.", author: "John A. Shedd" },
  { text: "Programs must be written for people to read, and only incidentally for machines to execute.", author: "Harold Abelson" },
  { text: "It always seems impossible until it's done.", author: "Nelson Mandela" },
  { text: "The purpose of computing is insight, not numbers.", author: "Richard Hamming" },
  { text: "You miss 100% of the shots you don't take.", author: "Wayne Gretzky" },
  { text: "The measure of intelligence is the ability to change.", author: "Albert Einstein" },
  { text: "What we know is a drop, what we don't know is an ocean.", author: "Isaac Newton" },
  { text: "Don't watch the clock; do what it does. Keep going.", author: "Sam Levenson" },
  { text: "If you want to go fast, go alone. If you want to go far, go together.", author: "African Proverb" },
  { text: "Be yourself; everyone else is already taken.", author: "Oscar Wilde" },
  { text: "One machine can do the work of fifty ordinary men. No machine can do the work of one extraordinary man.", author: "Elbert Hubbard" },
];

const JOKES: string[] = [
  "Why do programmers prefer dark mode? Because light attracts bugs.",
  "A SQL query walks into a bar, walks up to two tables and asks... 'Can I join you?'",
  "There are only 10 types of people in the world: those who understand binary and those who don't.",
  "Why was the JavaScript developer sad? Because he didn't Node how to Express himself.",
  "What's a computer's favourite snack? Microchips.",
  "Why do Java developers wear glasses? Because they don't C#.",
  "How many programmers does it take to change a lightbulb? None, that's a hardware problem.",
  "I told my wife she was drawing her eyebrows too high. She looked surprised.",
  "A photon checks into a hotel. The bellhop asks 'Can I help you with your luggage?' The photon says 'No thanks, I'm travelling light.'",
  "Why don't scientists trust atoms? Because they make up everything.",
  "I'm reading a book about anti-gravity. It's impossible to put down.",
  "What do you call a bear with no teeth? A gummy bear.",
  "Parallel lines have so much in common. It's a shame they'll never meet.",
  "I used to hate facial hair, but then it grew on me.",
  "What sits at the bottom of the sea and twitches? A nervous wreck.",
  "Why did the developer go broke? Because he used up all his cache.",
  "What's the object-oriented way to become wealthy? Inheritance.",
  "A man walks into a library and asks for books about paranoia. The librarian whispers 'They're right behind you.'",
  "I asked the gym instructor if he could teach me to do the splits. He said 'How flexible are you?' I said 'I can't make Tuesdays.'",
  "Why did the functions stop calling each other? Because they got too many arguments.",
  "What did the ocean say to the beach? Nothing, it just waved.",
  "I told my computer I needed a break, and now it won't stop sending me Kit Kat ads.",
  "Why do cows have hooves instead of feet? Because they lactose.",
  "What's the best thing about Switzerland? I don't know, but the flag is a big plus.",
  "Why did the scarecrow win an award? He was outstanding in his field.",
  "I would tell you a UDP joke, but you might not get it.",
  "There are two hard things in computer science: cache invalidation, naming things, and off-by-one errors.",
  "My wife told me to stop impersonating a flamingo. I had to put my foot down.",
  "What do you call a fake noodle? An impasta.",
  "Did you hear about the mathematician who's afraid of negative numbers? He'll stop at nothing to avoid them.",
  "Why did the chicken go to the seance? To get to the other side.",
];

function dayOfYear(): number {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 0));
  const diff = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - start.getTime();
  return Math.floor(diff / 86400000);
}

export function getDailyQuote(): { text: string; author: string } {
  return QUOTES[dayOfYear() % QUOTES.length];
}

export function getDailyJoke(): string {
  // Offset by half so quote and joke don't cycle in lockstep
  return JOKES[(dayOfYear() + 17) % JOKES.length];
}
