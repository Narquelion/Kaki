import styles from '../styles/Learn.module.css'
import Pitch from "../components/pitch";
import CategoryPicker from '../components/categorypicker';

import React, { useEffect, useState } from "react";
import { useQuery, useLazyQuery, useMutation, gql } from "@apollo/client";
import { useSession } from "next-auth/react";


const CREATE_STUDY_ITEM = gql`
mutation CreateUpdateStudyItem($username: String!, $tangoId: [Int]!, $due: String!) {
    createUpdateStudyItem(username: $username, tangoId: $tangoId, due: $due) {
        ok
        items {
            id
            item {
                tango
                yomi
                pitch
                definition
                pos
            }
            due
            interval
            easingFactor
        }
    }
}`

const UPDATE_STUDY_ITEM = gql`
mutation UpdateStudyItem($username: String!, $id: Int!, $due: String!) {
    updateStudyItem(username: $username, id: $id, due: $due) {
        ok
    }
}`

const QUERY_STUDY_ITEMS = gql`
query StudyItems($username: String, $category: String, $getDue: Boolean) {
    studyItems(username: $username, category: $category, getDue: $getDue) {
        id
        item {
            tango
            yomi
            pitch
            definition
            pos
        }
        due
        interval
        easingFactor
    }
}`

const QUERY_WORDS = gql`
query Words($category: String) {
    words(category: $category) {
        id
        tango
        yomi
        pitch
        definition
        pos
    }
}`

/* Things to look into: Children, context, redux? */

const Loading = ( { lang } ) => {

    const text = {
        "EN": "Loading study session...",
        "JA": "読み込み中..."
    };

    return(
        <section className="w-3/4 text-center">
        <div className="text-2xl">
            <h2 className={styles.tango}>{text[lang]}</h2>
        </div>
        </section>
    );
}

function Learn( { lang } ) {

    const { data: session, status } = useSession();
    const [ category, setCategory ] = useState('');

    return(
        <section className={styles.learn}>
            {status === "loading" && (<Loading lang={lang}/>)}
            {category !== '' && (<QuizWrapper lang={lang} user={session?.user} category={category} setCategory={setCategory}/>)}
            {category === '' && (<CategoryPicker lang={lang} displayStyle={"full"} setCategory={setCategory}/>)}
        </section>
    );
}

const QuizWrapper = ( { lang, user, category, setCategory } ) => {
    
    console.log("Setting up queries.");

    const username = user?.username;

    // Query a user's study items
    const [ queryItems, itemStatus ] = useLazyQuery(QUERY_STUDY_ITEMS, { 
        variables: { username: username, category: category, getDue: true } 
    });

    // Query all words in the current category
    const [ queryWords, wordStatus ] = useLazyQuery(QUERY_WORDS, { 
        variables: { category: category } 
    });

    // Add study items for a user
    const [ createItems, createStatus ] = useMutation(CREATE_STUDY_ITEM, {
        refetchQueries: [ 
            {
                query: QUERY_STUDY_ITEMS, 
                variables: { username: username, category: category, getDue: true }
            },
            'StudyItems'
        ]
      });   

    // Make it easier to access queries and mutations
    const queries = {
        items: {
            query: queryItems,
            data: itemStatus.data,
            loading: itemStatus.loading,
            error: itemStatus.error
        },
        words: {
            query: queryWords,
            data: wordStatus.data,
            loading: wordStatus.loading,
            error: wordStatus.error
        }
    }

    const mutations = {
        create: {
            mutation: createItems,
            data: createStatus.data,
            loading: createStatus.loading,
            error: createStatus.error
        }
    }

    if (wordStatus.loading || itemStatus.loading || createStatus.loading) {
        return(<Loading lang={lang}/>);
    }
        
    if (wordStatus.error || itemStatus.error || createStatus.error) {
        return(
            <pre>
                {wordStatus?.error?.message}
                {itemStatus?.error?.message}
                {createStatus?.error?.message}
            </pre>
        );
    }

    return(
        <StudyCard lang={lang} user={user} setCategory={setCategory} queries={queries} mutations={mutations}/>
    );
}

const handleStudyItems = ( quizState, setQuizState, queries ) => {
    
    console.log("Handling study items...");
        
    // Don't try to check study items if no one is logged in
    if(!quizState.username) {
        console.log("No user. Querying words...");
        queries.words.query();
        return;
    }

    // Avoid multiple queries?
    if(queries.items.loading) return;

    // If we don't have any data yet, query it
    if(!queries.items.data) {
        console.log("Study item data is null. Querying...");
        queries.items.query();
        return;
    }
    
    const items = queries.items.data.studyItems;
    console.log(`Got ${items.length} study items!`);
    
    // If there is no study data for this category, create it
    // Otherwise, initialize the study session
    if (items.length == 0) {
        console.log("Getting words from category...");
        queries.words.query();
        return;
    }

    let state = getNextWord(fisherYates(items));
    state.username = quizState.username;
    setQuizState(state);
}

const handleWords = (quizState, setQuizState, queries, mutations ) => {
    
    console.log("Handling words...");

    // Avoid unnecessary queries
    if(queries.words.loading) return;
    if(quizState.username && (queries.items.loading || queries.items.data == undefined )) return; 
    if(quizState.username && queries.items.data.studyItems.length > 0) return;

    // If we don't have any data yet, query it
    if(!queries.words.data) {
        console.log("Word data is null. Querying...");
        queries.words.query();
        return;
    }

    // If we're querying because the user needs to add words, run mutation
    // Otherwise, initialize a non-logged-in study session
    if(quizState.username) {
        console.log("Creating study items.");
        let ids = Object.values(wordStatus.data.words).map(item => parseInt(item.id));
        console.log({variables: {username: quizState.username, tangoId: ids, due: new Date(Date.now()).toISOString()}});
        mutations.create.mutation({variables: {username: quizState.username, tangoId: ids, due: new Date(Date.now()).toISOString()}});
    } else {
        let state = getNextWord(fisherYates(queries.words.data.words));
        state.username = quizState.username;
        console.log(state);
        setQuizState(state);
    }
}
const StudyCard = ( { lang, user, setCategory, queries, mutations }) => {

    const [ answerState, setAnswerState ] = useState( { clicked: -1, result: '' } );
    const [ visible,     setVisible ]     = useState( false );
    const [ quizState,  setQuizState ]  = useState( {
        username: user?.username, 
        word: null,
        words: [], 
        answerList: []
    });
    
    useEffect(() => {
        handleStudyItems(quizState, setQuizState, queries)
    }, [queries.items.status]);

    useEffect(() => {
        handleWords(quizState, setQuizState, queries, mutations);
    }, [queries.words.status]);

    // Hide info when word changes
    useEffect(() => {
        setVisible(false)
    }, [quizState.word]);

    console.log("Rendering study card...");

    const handleInput = (e) => {
        
        console.log(e.code);
        
        if(answerState.clicked != -1) {
            if(e.code === 'Enter' || e.code === 'ArrowRight'){
                toNextWord();
            }
        }
    
        if(e.code === 'KeyD') {
            setVisible(!visible);
        }
    
        if(e.code === 'Digit1') {
            setAnswerState({clicked: 0});
        }
    
        if(e.code === 'Digit2' && quizState.answerList.length >= 2) {
            setAnswerState({clicked: 1});
        }
    
        if(e.code === 'Digit3' && quizState.answerList.length >= 3) {
            setAnswerState({clicked: 2});
        }
    
        if(e.code === 'Digit4' && quizState.answerList.length >= 4) {
            setAnswerState({clicked: 3});
        }
    }


    
    let feedback = (lang === "EN" ? "Correct!" : "正解！");
    if(answerState.result === "incorrect") {
        feedback = (lang === "EN" ? "Too bad!" : "次は頑張ってね！");
    }

    const toNextWord = () => {
        let words = quizState.words;
        if(answerState.result === 'incorrect') {
            words.unshift(quizState.word);
        }
        let state = getNextWord(words);
        state.username = quizState.username;
        setQuizState(state);
        setAnswerState({ clicked: -1, result: ''});
    }

    if(quizState.word == null) {
        return(
            <section className="w-3/4 text-center">
                <div className="text-2xl">
                    <h2 className={styles.tango}>{lang === "EN" ? "Congrats! You finished studying for today!" : "おめでとうございます！今日の学習が終わりました。"}</h2>
                </div>
            </section>
        );
    }

    function handleClick(e) {
        e.preventDefault();
        setVisible(!visible);
    }

    return(
            <><section tabIndex={0} onKeyDown={handleInput} className="relative flex flex-col basis-full md:basis-3/4 w-full justify-between items-center shadow-md">
                <div className="relative flex flex-col justify-evenly w-full basis-full">
                    <div className={(visible ? '' : 'hidden') + " absolute h-full w-full bg-white/50 md:hidden"}/>
                    <div className="flex justify-center">
                    <h2 className={styles.tango + " my-2 text-7xl md:text-7xl lg:text-7xl mb-2"}>{quizState.word.item.tango}</h2>
                    </div>
                    <ButtonGrid answerList={quizState.answerList} setAnswerState={setAnswerState} answerState={answerState} quizState={quizState}/>
                    <div className="text-center" style={{"visibility": (answerState.clicked == -1 ? "hidden" : "visible")} }>
                        <button type="button" className="my-2" onClick={() => toNextWord()}>{feedback} →</button>
                    </div>       
                </div>
                <div className="flex w-full justify-between md:justify-end items-end pb-2">
                        <button onClick={handleClick} className="text-white text-sm block md:hidden rounded-md bg-gray-400 p-3 ml-4">{visible ? "Hide info" : "Show info"}</button>
                        <CategoryPicker setCategory={setCategory} displayStyle={"menu"}/>
                </div>
            </section>
            <Definition word={quizState.word} answerState={answerState} lang={lang} visible={visible} setVisible={setVisible}/>
   </> );
}

const Definition = ( { word, answerState, lang, visible, setVisible } ) => {
    

    function handleClick(e) {
        e.preventDefault();
        setVisible(!visible);
    }

    let text = "";
    if(!visible) {
        text = lang === 'EN' ? "Show word details" : "詳細を表示する";
    }
 
    return(
        <div className={(visible ? '' : "hidden") + " rounded-md w-3/4 h-1/2 shadow-lg absolute md:shadow-none md:relative md:block bg-gray-200 dark:bg-gray-900 dark:border-gray-600 md:basis-1/4 border-t-4 border-gray-200 md:w-full"}>
            <div className="overflow-scroll h-full">
                {! visible && (<div onClick={handleClick} className="text-gray-900 hover:cursor-pointer hover:text-orange-500 flex w-full h-full items-center justify-center">
                    <button className="font-normal bg-transparent hover:bg-transparent hover:text-orange-500 shadow-none" onClick={handleClick}>{text}</button>
                    </div>)}
                {visible && (
                <div style={{visibility: (visible ? "visible" : "hidden")}} className="flex flex-col items-center align-center md:flex-row h-full">
                    <div className="flex border-b-2 md:border-b-0 md:border-r-2 border-gray-400 w-1/2 md:w-1/4 justify-center items-center text-center px-1">
                        <div className="mt-2">
                            <p className="text-orange-700 dark:text-orange-500 text-5xl md:text-2xl mb-3">{word.tango}</p>
                            {answerState.clicked != -1 && (<p className="text-lg font-normal text-black dark:text-white"><Pitch word={word}/></p>)}
                            {answerState.clicked == -1 && (<p className="text-lg font-normal text-black dark:text-white">{word.yomi}</p>)}
                        </div>
                    </div>
                    <div className="text-lg font-normal text-black dark:text-white w-3/4 p-4">
                        <p className="text-base text-italic text-gray-700 dark:text-gray-100 ">{word.pos}</p>
                        <p>{word.definition}</p>
                    </div>
                </div>)}
            </div>
        </div>
    );
}

const ButtonGrid = ( { answerList, setAnswerState, answerState, quizState, setQuizState } ) => {

    
    const [ mutateStudyItem, mutationStatus ] = useMutation(UPDATE_STUDY_ITEM);

    const toNextWord = ( result, i ) => {
        
        setAnswerState({ clicked: i, result: result });
       
        if(quizState.username) {
                 
            let due = new Date(Date.now() + 86400000 * parseInt(quizState.word.interval)).toISOString();
            let interval = parseInt(quizState.word.interval) * parseInt(quizState.word.easingFactor);
            
            if(result == "incorrect") {
                interval = 1;
                due = new Date(Date.now()).toISOString();
            }

            console.log({
                variables: {
                username: quizState.username, 
                id: parseInt(quizState.word.id), 
                due: due,
                interval: interval
            }});

            // mutateStudyItem({
            //     variables: {
            //         username: quizState.username, 
            //         id: parseInt(quizState.word.id), 
            //         due: due,
            //         interval: interval
            //     }
            // });
        }
    }

    return(
        <div className="flex w-full justify-center">
            <div className={styles.buttonGrid}>
                {answerList.map((option, i) =>             
                <AnswerButton key={"button" + i} i={i} answerState={answerState} option={option} toNextWord={toNextWord}/>)}
            </div>
        </div>
    );

}

const AnswerButton = ( { i, option, answerState, toNextWord } ) => {
    
    let feedback = '';
    console.log(answerState.clicked);

    if(answerState.clicked >= 0) {
        if (option.correct) {
            feedback = "correct";
        }
        else if (i == answerState.clicked && !option.correct) {
            feedback = "incorrect";
        }
    } 

    const handleClick = (e) => {
        e.preventDefault;
        let result = "correct";
        if(!option.correct) {
            result = "incorrect"
        }
        toNextWord(result, i);
    }

    return (
        <button disabled={ (answerState.clicked != -1 ? true : false) } className={styles[feedback]} onClick={handleClick}>
            <Pitch word={option} />
        </button>
    );
}

function getNextWord(words) {
    console.log(words);
    let word = words.pop();
    console.log(word);
    
    if(!word) return { word: null, words: null, answerList: null};

    if(word.__typename === "StudyItemType") {
        return { 
            word: word,
            words: words, 
            answerList: generateAnswers(word.item)
        };
    }
    return { 
        word: {
            item: word
        },
        words: words,
        answerList: generateAnswers(word)
    };
}

function getRandomWord(words) {
    return words.pop();
}

function generateAnswers(word) {
   
    if(!word) return [];

    const morae = getMorae(word.yomi);
    
    let answers = [];
    let correctAnswer = {};

    for(let i=0; i < morae.length+1; i++) {
        let answer = { 
            yomi: word.yomi,
            pitch: i,
            correct: (i == word.pitch ? true : false)
        };
        if( i != word.pitch) {
            answers.push(answer);
        } else {
            correctAnswer = answer;
        }
    }

    answers = fisherYates(answers).filter((word) => {
        let pitchedMora = word.yomi[word.pitch-1];
        let invalidMorae = ["っ", "ー"];
        return (word.pitch == 0 || !invalidMorae.includes(pitchedMora));
    });

    answers = answers.length > 3 ? answers.slice(0, 3) : answers;
    
    let randIdx = Math.floor(Math.random() * answers.length);
    answers.splice(randIdx, 0, correctAnswer);
    
    return answers;
}

function fisherYates(arr) {
    var shuffled = arr.slice(0), i = arr.length, temp, index;
    while (i--) {
        index = Math.floor((i + 1) * Math.random());
        temp = shuffled[index];
        shuffled[index] = shuffled[i];
        shuffled[i] = temp;
    }
    return shuffled;
}

// TODO: Currently duplicated in pitch.js
const getMorae = (word) => {
    
    let chars = word.split('');
    let morae = [];
    let currentMora = chars.shift();
  
    for(let i in chars) {
        if(['ゃ','ゅ','ょ'].includes(chars[i])) {
            currentMora += chars[i];
        } else {
            morae.push(currentMora);
            currentMora = chars[i];
        }
    }
    morae.push(currentMora);
    return morae;
}

export default Learn;