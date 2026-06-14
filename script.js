let allMessages = [];

const chat = document.getElementById("chat");
const searchBox = document.getElementById("searchBox");
const searchInfo = document.getElementById("searchInfo");
const searchNav = document.getElementById("searchNav");
const matchCounter = document.getElementById("matchCounter");

const prevMatchBtn = document.getElementById("prevMatch");
const nextMatchBtn = document.getElementById("nextMatch");

const datePicker = document.getElementById("datePicker");
const monthList = document.getElementById("monthList");
const sidebar = document.getElementById("sidebar");
const menuButton = document.getElementById("menuButton");

menuButton.onclick = () => sidebar.classList.toggle("open");

/* ---------- STATE ---------- */
let loadedCount = 0;
const BATCH_SIZE = 100;

let searchTerm = "";
let matches = [];
let currentMatchIndex = -1;

/* ---------- LOAD DATA ---------- */
fetch("chat.json")
.then(r => r.json())
.then(data => {

    allMessages = data;

    loadMore();
    buildMonthList();
    setupInfiniteScroll();

});

function loadMore(){

    let end = Math.min(loadedCount + BATCH_SIZE, allMessages.length);

    for(let i = loadedCount; i < end; i++){
        appendMessage(allMessages[i], i);
    }

    loadedCount = end;
}

function appendMessage(msg, index){

    let div = document.createElement("div");

    div.className = "message";

    if(msg.sender === "Amirhosein")
        div.classList.add("me");
    else
        div.classList.add("other");

    div.dataset.index = index;

    let text = escapeHtml(msg.text);

    if(searchTerm){
        text = highlightText(text, searchTerm);
    }

    div.innerHTML = `
        <div class="sender">${msg.sender}</div>
        <div class="text">${text}</div>
        <div class="time">${msg.timestamp}</div>
    `;

    chat.appendChild(div);
}

function escapeHtml(text){
    return text
        .replaceAll("&","&amp;")
        .replaceAll("<","&lt;")
        .replaceAll(">","&gt;");
}

function highlightText(text, term){

    if(!term) return text;

    let regex = new RegExp(term, "gi");

    return text.replace(
        regex,
        m => `<span class="highlight">${m}</span>`
    );
}

function setupInfiniteScroll(){

    chat.addEventListener("scroll", () => {

        if(chat.scrollTop + chat.clientHeight > chat.scrollHeight - 300){

            if(loadedCount < allMessages.length){
                loadMore();
            }

        }

    });

}

searchBox.addEventListener("input", () => {

    searchTerm = searchBox.value.trim().toLowerCase();

    matches = [];
    currentMatchIndex = -1;

    if(searchTerm === ""){

        searchInfo.innerText = "";
        searchNav.style.display = "none";

        rerender();

        return;
    }

    for(let i = 0; i < allMessages.length; i++){

        if(allMessages[i].text.toLowerCase().includes(searchTerm)){
            matches.push(i);
        }
    }

    if(matches.length === 0){

        searchInfo.innerText = "0 results";
        searchNav.style.display = "none";

        return;
    }

    searchInfo.innerText = `${matches.length} results`;
    searchNav.style.display = "flex";

    currentMatchIndex = 0;

    rerender();
    scrollToMatch();
});

function rerender(){

    chat.innerHTML = "";
    loadedCount = 0;
    loadMore();
}

prevMatchBtn.onclick = () => {

    if(!matches.length) return;

    currentMatchIndex =
        (currentMatchIndex - 1 + matches.length) % matches.length;

    scrollToMatch();
};

nextMatchBtn.onclick = () => {

    if(!matches.length) return;

    currentMatchIndex =
        (currentMatchIndex + 1) % matches.length;

    scrollToMatch();
};

function scrollToMatch(){

    let index = matches[currentMatchIndex];

    let el = document.querySelector(
        `.message[data-index="${index}"]`
    );

    if(!el) return;

    el.scrollIntoView({
        behavior: "smooth",
        block: "center"
    });

    matchCounter.innerText =
        `${currentMatchIndex + 1} / ${matches.length}`;
}

function buildMonthList(){

    let months = new Set();

    allMessages.forEach(m => {
        months.add(m.timestamp.slice(3,10));
    });

    [...months].forEach(month => {

        let div = document.createElement("div");

        div.className = "month";
        div.innerText = month;

        div.onclick = () => {

            let index = allMessages.findIndex(
                m => m.timestamp.includes(month)
            );

            if(index !== -1){
                document
                    .querySelector(`[data-index="${index}"]`)
                    ?.scrollIntoView({behavior:"smooth"});
            }
        };

        monthList.appendChild(div);
    });
}