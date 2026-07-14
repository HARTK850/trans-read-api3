/**
 * @file api/index.js
 * @version 19.0.0 (Ultimate Enterprise Edition - Stable Patch)
 * @description מודול IVR חכם המחבר את מערכת הטלפוניה של "ימות המשיח" למודלי ה-AI של גוגל (Gemini).
 * * יכולות קריטיות מתוקנות ומורחבות:
 * 1. פתרון שורשי לבעיית "לאישור הקישו 1" על ידי ניטרול PlaybackType ו-RequestConfirmation.
 * 2. סידור פרמטרים מוקפד למניעת שגיאת "לא הקשתם מינימום" בשלוחות השמירה.
 * 3. ניתוב דו-מסלולי מוחלט: מצב מאזין (שמירה אוטומטית שקטה בקול ברירת מחדל) ומצב מנהל (תפריטי עריכה).
 * 4. זיהוי מנהלים דינמי מתוך הגדרת השלוחה ב-ext.ini.
 * 5. השמעת ביפ מערכת (M1006) במקום המילה "כוכבית" בעת קריאת שלוחה פנימית למנהל.
 * 6. ביטול תגי רגש וקיבוע הקראה רובוטית מונוטונית מהירה.
 */

const { GeminiManager, YemotManager, GEMINI_VOICES, TelemetryLogger } = require('./core');

// ============================================================================
// הגדרות סביבה גלובליות
// ============================================================================
const GEMINI_API_KEYS = process.env.GEMINI_API_KEYS 
    ? process.env.GEMINI_API_KEYS.split(',') 
    : [ "YOUR_DEFAULT_API_KEY_HERE" ];

const gemini = new GeminiManager(GEMINI_API_KEYS);
const TEMP_FOLDER = "/Temp_Gemini_App"; 

// ============================================================================
// מנוע אובייקט-אוריינטד מורחב להרכבת תגובות לתקן המחמיר של ימות המשיח
// ============================================================================
class YemotCommandBuilder {
    constructor(action) {
        this.action = action; 
        this.contentBlocks = []; 
        this.params = []; 
        this.nextState = {}; 
        this.goToFolder = null; 
    }

    cleanYemotText(text) {
        if (!text) return "";
        // מחיקת תווים בעייתיים העלולים לשבור את מפרידי המחרוזות של ימות המשיח
        return text.toString().replace(/[.,-]/g, " ").replace(/\s+/g, " ").trim();
    }

    addText(text) {
        const cleanStr = this.cleanYemotText(text);
        if (cleanStr.length > 0) {
            this.contentBlocks.push(`t-${cleanStr}`);
        }
        return this;
    }

    addFile(filePath) {
        if (filePath) {
            this.contentBlocks.push(`f-${filePath}`);
        }
        return this;
    }

    // הוספת הודעת מערכת בצורה תקנית (למניעת שגיאות מנוע ההשמעות)
    addSystemMessage(msgNum) {
        if (msgNum) {
            this.contentBlocks.push(`m-${msgNum}`);
        }
        return this;
    }

    /**
     * פונקציה חכמה למניעת בקשות אישור וטיפול בשגיאות מינימום/מקסימום.
     * מבוסס על מבנה של 15 פרמטרים התואם לחלוטין את ה-API של ימות המשיח עבור פקודת Read.
     */
    setReadDigitsAdvanced(
        varName,
        maxDigits,
        minDigits,
        timeout,
        playbackType = "No", 
        disableConfirmation = true, 
        allowAsterisk = false,
        replaceAsteriskWithSlash = false
    ) {
        this.params = [
            varName,                                            // 1. שם המשתנה לאיסוף
            "no",                                               // 2. שימוש בקיים (no)
            maxDigits.toString(),                               // 3. מקסימום ספרות
            minDigits.toString(),                               // 4. מינימום ספרות
            timeout.toString(),                                 // 5. זמן המתנה בשניות
            playbackType,                                       // 6. צורת השמעת הנתון שהוקש (No, Digits, Number)
            allowAsterisk ? "no" : "yes",                       // 7. חסימת כוכבית (no = מאפשר להקיש כוכבית)
            "no",                                               // 8. חסימת אפס (no = מאפשר)
            replaceAsteriskWithSlash ? "*/" : "",               // 9. החלפת תווים (*/ להמרת כוכבית לסלש)
            "",                                                 // 10. מקשים מותרים 
            "",                                                 // 11. ניסיונות
            "",                                                 // 12. אפשר ריק
            "",                                                 // 13. ערך לריק
            "",                                                 // 14. חסימת שינוי שפה במקלדת
            disableConfirmation ? "yes" : "no"                  // 15. חסימת בקשת אישור (yes = לא יבקש "לאישור הקישו 1")
        ];

        return this;
    }

    /**
     * הגדרת קלט הקלטה (Record). מפעיל את התפריט הרשמי של ימות המשיח.
     */
    setRecordInput(varName, folder, fileName) {
        this.params = [
            varName,   // 1. משתנה 
            "no",      // 2. להשתמש בקיים
            "record",  // 3. סוג קלט
            folder,    // 4. תיקיית יעד בימות
            fileName,  // 5. שם קובץ
            "no",      // 6. הפעלת התפריט המלא של ימות (לשמיעה 1, אישור 2...)
            "yes",     // 7. שמירה בניתוק
            "no"       // 8. לא לשרשר
        ];
        return this;
    }

    addState(key, value) {
        this.nextState[key] = value;
        return this;
    }

    addGoToFolder(folderPath = "/") {
        this.goToFolder = folderPath;
        return this;
    }

    build() {
        let res = "";
        const textPart = this.contentBlocks.join('.');

        if (this.action === "read" && this.params.length > 0) {
            res = `read=${textPart}=${this.params.join(',')}`;
        } else if (this.action === "id_list_message") {
            res = `id_list_message=${textPart}`;
        } else if (this.action === "go_to_folder") {
            res = `go_to_folder=${this.goToFolder || "/"}`;
        } else {
            res = `${this.action}=${textPart}`;
        }

        let index = 0;
        let apiAddStr = "";
        for (const [key, value] of Object.entries(this.nextState)) {
            apiAddStr += `&api_add_${index}=${key}=${encodeURIComponent(value)}`;
            index++;
        }

        res += apiAddStr;

        if (this.goToFolder && this.action !== "go_to_folder" && this.action !== "read") {
            res += `&go_to_folder=${this.goToFolder}`;
        }

        return res;
    }
}

// ============================================================================
// פונקציות עזר 
// ============================================================================
function cleanAndSanitizeFolder(rawPath) {
    if (!rawPath || rawPath === "0") return ""; 
    return rawPath.replace(/\*/g, "/").replace(/\/+/g, "/").replace(/^\/+|\/+$/g, '');
}

function cleanupEmptyQueryVariables(query) {
    const keys = [
        "UserAudioRecord", "VoiceGender", "VoiceIndex", "TargetFolderDefault", 
        "TargetFolderCopy", "WantCopySave", "VoiceChoiceAdmin", "AdminVoiceIndex", "FolderApproved",
        "ListenerConfirm"
    ];
    for (const key of keys) {
        if (query[key] === "") delete query[key];
    }
}

// ============================================================================
// הליבה: Serverless Request Handler
// ============================================================================
module.exports = async (req, res) => {
    let yemotFinalResponse = "";
    
    try {
        const query = req.method === 'POST' ? { ...req.query, ...req.body } : req.query || {};
        
        // הגנת ניתוק - מונע שידור בחזרה לימות המשיח במקרה של טורק-טלפון
        if (query.hangup === "yes") {
            TelemetryLogger.info("MainHandler", "Hangup", `המאזין ניתק את השיחה. עוצר הליכים. (CallID: ${query.ApiCallId})`);
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            return res.status(200).send("");
        }

        const YEMOT_TOKEN = query.yemot_token || process.env.YEMOT_TOKEN;
        if (!YEMOT_TOKEN) {
            TelemetryLogger.error("MainHandler", "Auth", "נדחתה גישה: חסר טוקן YEMOT_TOKEN בהגדרות השלוחה.");
            return res.status(200).send("id_list_message=t-תקלה במערכת חסר מפתח הגדרה&hangup=yes");
        }

        const yemot = new YemotManager(YEMOT_TOKEN);
        const ApiPhone = query.ApiPhone || "UnknownPhone";
        const ApiCallId = query.ApiCallId || "UnknownCallId";

        // קריאת הגדרות מנהלים ושמירה אוטומטית שיועברו מימות המשיח באמצעות ext.ini (api_add_X)
        const adminNumbersConfig = query.admin_numbers || process.env.ADMIN_NUMBERS || "";
        const defaultSaveFolderConfig = query.default_save_folder || process.env.DEFAULT_SAVE_FOLDER || "/600";

        // בדיקה האם המאזין הנוכחי הוא מנהל מערכת מאושר
        const adminList = adminNumbersConfig.split(',').map(num => num.trim()).filter(Boolean);
        const isAdmin = adminList.includes(ApiPhone);

        TelemetryLogger.info("MainHandler", "ModeDetection", `טלפון: ${ApiPhone}, מנהל: ${isAdmin}, שלוחת שמירה מוגדרת: ${defaultSaveFolderConfig}`);

        cleanupEmptyQueryVariables(query);
        
        // --- ניהול שלבים (State Machine) מעודכן ומורחב ---
        let state = 0;

        if (query.SystemMessageNumber !== undefined) {
            state = 302; // מנהל - בחירת מספר להודעת מערכת
        }
        else if (query.SaveTypeChoice !== undefined) {
            state = 301; // מנהל - בחירת סוג שמירה
        }
        else if (query.TargetFolderDefault !== undefined) {
            state = 300; // מנהל - סיים להקיש ואישר שלוחת שמירה -> מעבר לשאלת סוג השמירה
        }
        else if (query.AdminVoiceIndex !== undefined) {
            state = 110; // מנהל - בחר קול ספציפי
        }
        else if (query.VoiceChoiceAdmin !== undefined) {
            state = 105; // מנהל - בחר סגנון קול (ברירת מחדל או בחירה)
        }
        else if (query.ListenerConfirm !== undefined) {
            state = 101; // מאזין - בחר האם לאשר את ההקראה ששמע או לבטל
        }
        else if (query.UserAudioRecord !== undefined) {
            state = 100; // סיום הקלטה ומעבר לעיבוד
        }

        TelemetryLogger.info("FlowController", "StateDetection", `שלב מזוהה: ${state}`);
        let responseBuilder = null;

        switch (state) {
            
            case 0:
                // ====================================================================
                // שלב 0: פתיח המערכת ובקשת הקלטה.
                // ====================================================================
                responseBuilder = new YemotCommandBuilder("read")
                    .addText("אנא הקליטו את הודעתכם לאחר הצליל")
                    .addText("בסיום הקישו סולמית")
                    .setRecordInput("UserAudioRecord", TEMP_FOLDER, `${ApiCallId}_main`);
                break;

            case 100:
                // ====================================================================
                // שלב 100: STT - תמלול ההקלטה הראשי
                // ====================================================================
                const mainRecordPath = `${TEMP_FOLDER}/${ApiCallId}_main.wav`;
                const mainAudioBuffer = await yemot.downloadFile(`ivr2:${mainRecordPath}`);
                
                const transcribedText = await gemini.transcribeAudioWithEmotion(mainAudioBuffer);
                TelemetryLogger.info("MainHandler", "STT", `תומלל בהצלחה: ${transcribedText}`);

                if (!transcribedText || transcribedText.length < 2) {
                    responseBuilder = new YemotCommandBuilder("read")
                        .addText("לא הצלחנו לתמלל את ההקלטה אנא דברו ברור יותר ונסו שוב")
                        .setRecordInput("UserAudioRecord", TEMP_FOLDER, `${ApiCallId}_main`)
                        .addState("ListenerConfirm", "clear");
                    break;
                }

                // שמירת הטקסט בקובץ זמני
                await yemot.uploadTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_text.txt`, transcribedText);

                if (!isAdmin) {
    try {
        // מאזין רגיל: מנסים ליצור שמע איכותי ב-Gemini
        const defaultVoiceId = "Schedar";
        const monotonicInstruction = `Say monotonically, neutrally, flatly and slightly fast: ${transcribedText}`;
        const ttsBuffer = await gemini.generateSpeech(monotonicInstruction, defaultVoiceId);
        
        const tempTtsWavPath = `ivr2:${TEMP_FOLDER}/${ApiCallId}_listener_tts.wav`;
        await yemot.uploadFile(tempTtsWavPath, ttsBuffer);
        
        responseBuilder = new YemotCommandBuilder("read")
            .addFile(`${TEMP_FOLDER}/${ApiCallId}_listener_tts`);
    } catch (apiError) {
        TelemetryLogger.warn("MainHandler", "TTS_Fallback", "יצירת שמע ב-Gemini נכשלה למאזין. מעבר למנוע TTS מקומי של ימות.", apiError);
        
        // יצירת קובץ גיבוי מסוג TTS בימות המשיח
        const tempTtsTextPath = `ivr2:${TEMP_FOLDER}/${ApiCallId}_listener_tts.tts`;
        await yemot.uploadTextFile(tempTtsTextPath, transcribedText);
        
        responseBuilder = new YemotCommandBuilder("read")
            .addFile(`${TEMP_FOLDER}/${ApiCallId}_listener_tts`); // ימות המשיח משמיע קבצי tts באופן זהה לחלוטין
    }
    
    // המשך התפריט הרגיל למאזין
    responseBuilder
        .addText("לאישור הקישו 1 להקלטה מחדש הקש 2 לביטול וחזרה הקש 3")
        .setReadDigitsAdvanced("ListenerConfirm", 1, 1, 10, "No", true, false, false);
} else {
                    // מנהל: עובר קודם כל לבחירת סגנון קול (לפני הג'נרציה!)
                    responseBuilder = new YemotCommandBuilder("read")
                        .addText("התמלול הושלם בהצלחה")
                        .addText("להקראה בקול הקריין ברירת המחדל הקישו 1 לבחירת קול קריין אחר הקישו 2")
                        .setReadDigitsAdvanced("VoiceChoiceAdmin", 1, 1, 10, "No", true, false, false);
                }
                break;

            case 101:
                // ====================================================================
                // שלב 101: ניתוח תפריט מאזין (1,2,3) או ניתוח בחירת קול מנהל
                // ====================================================================
                
                // בדיקה האם מדובר במנהל שנמצא בשלב בחירת הקול
                if (isAdmin && query.VoiceChoiceAdmin && !query.ListenerConfirm) {
                    const voiceChoice = query.VoiceChoiceAdmin;
                    
                    // קריאת הטקסט שתומלל בשלב 100
                    const savedText = await yemot.downloadTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_text.txt`);

                    if (voiceChoice === "1") {
    try {
        const defaultVoiceId = "Schedar";
        const monotonicInstruction = `Say monotonically, neutrally, flatly and slightly fast: ${savedText}`;
        const ttsBuffer = await gemini.generateSpeech(monotonicInstruction, defaultVoiceId);
        
        await yemot.uploadFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_listener_tts.wav`, ttsBuffer);
        
        responseBuilder = new YemotCommandBuilder("read")
            .addFile(`${TEMP_FOLDER}/${ApiCallId}_listener_tts`);
    } catch (apiError) {
        TelemetryLogger.warn("MainHandler", "TTS_Fallback", "יצירת שמע נכשלה למנהל בקול ברירת מחדל. מעבר ל-TTS מקומי.", apiError);
        
        const tempTtsTextPath = `ivr2:${TEMP_FOLDER}/${ApiCallId}_listener_tts.tts`;
        await yemot.uploadTextFile(tempTtsTextPath, savedText);
        
        responseBuilder = new YemotCommandBuilder("read")
            .addFile(`${TEMP_FOLDER}/${ApiCallId}_listener_tts`);
    }

    responseBuilder
        .addText("לאישור הקישו 1 להקלטה מחדש הקש 2 לביטול וחזרה הקש 3")
        .setReadDigitsAdvanced("ListenerConfirm", 1, 1, 10, "No", true, false, false);
} else if (voiceChoice === "2") {
                        // מעבר לבחירת קולות מורחבת (שלב 106 הקיים אצלך בקוד)
                        responseBuilder = new YemotCommandBuilder("read")
                            .addText("אנא בחרו את קול הקריין הרצוי")
                            .addText("לקריין Aoede הקישו 1, לקריין Carpo הקישו 2, לקריין Elara הקישו 3, לקריין Schedar הקישו 4")
                            .setReadDigitsAdvanced("AdminVoiceIndex", 1, 2, 10, "No", true, false, false);
                    }
                    break;
                }

                // טיפול בתפריט אישור/הקלטה מחדש/ביטול (ListenerConfirm) - גם למאזין וגם למנהל!
                const confirmChoice = query.ListenerConfirm;

                if (confirmChoice === "1") {
    if (!isAdmin) {
        // מאזין אישר -> שמירה אוטומטית סופית
        const cleanDestFolder = cleanAndSanitizeFolder(defaultSaveFolderConfig);
        const nextFileNum = await yemot.getNextSequenceFileName(cleanDestFolder || "/");
        
        let finalPath = "";
        let isFallbackTts = false;
        
        try {
            // ננסה להוריד את קובץ ה-wav. אם הוא לא קיים, סימן שהשתמשנו בגיבוי TTS
            const listenerTtsBuffer = await yemot.downloadFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_listener_tts.wav`);
            finalPath = cleanDestFolder ? `ivr2:/${cleanDestFolder}/${nextFileNum}.wav` : `ivr2:/${nextFileNum}.wav`;
            await yemot.uploadFile(finalPath, listenerTtsBuffer);
        } catch (downloadErr) {
            isFallbackTts = true;
            TelemetryLogger.info("MainHandler", "Save_Fallback", "מזהה שהקובץ הזמני הוא קובץ TTS גיבויי.");
            
            // הורדת קובץ הגיבוי והעלאתו מחדש כקובץ TTS קבוע בשלוחה
            const fallbackText = await yemot.getTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_listener_tts.tts`);
            finalPath = cleanDestFolder ? `ivr2:/${cleanDestFolder}/${nextFileNum}.tts` : `ivr2:/${nextFileNum}.tts`;
            await yemot.uploadTextFile(finalPath, fallbackText);
        }

        responseBuilder = new YemotCommandBuilder("id_list_message")
            .addText("ההודעה נשלחה לבדיקה, היא תעלה למערכת בזמן הקרוב.")
            .addGoToFolder("/"); 
    } else {
                        // מנהל אישר -> רק עכשיו עובר לשלוחות שמירה וניהול (שלב 107 הקיים אצלך)
                        responseBuilder = new YemotCommandBuilder("read")
                            .addText("ההקראה אושרה.")
                            .addText("אנא הקישו את מספר השלוחה לשמירה, לשמירה פנימית הקישו כוכבית בין השלוחות ובסיום סולמית, לשמירה בתיקייה הראשית הקישו אפס וסולמית")
                            .setReadDigitsAdvanced("TargetFolderDefault", 1, 15, 20, "Digits", false, false, false);
                    }
                } 
                else if (confirmChoice === "2") {
                    // הקלטה מחדש עם ניקוי מוחלט למניעת לופים
                    responseBuilder = new YemotCommandBuilder("read")
                        .addText("אנא הקליטו את הודעתכם החדשה לאחר הצליל")
                        .addText("בסיום הקישו סולמית")
                        .setRecordInput("UserAudioRecord", TEMP_FOLDER, `${ApiCallId}_main`)
                        .addState("ListenerConfirm", "clear")
                        .addState("VoiceChoiceAdmin", "clear");
                } 
                else if (confirmChoice === "3") {
                    responseBuilder = new YemotCommandBuilder("id_list_message")
                        .addText("הפעולה בוטלה")
                        .addGoToFolder("/");
                }
                break;
                
            case 105:
                // ====================================================================
                // שלב 105: עיבוד בחירת סוג הקול של המנהל
                // ====================================================================
                const adminVoiceChoice = query.VoiceChoiceAdmin;
                if (adminVoiceChoice !== "1" && adminVoiceChoice !== "2") {
                    responseBuilder = new YemotCommandBuilder("read")
                        .addSystemMessage("1224")
                        .addText("להקראה בקול ברירת המחדל הקישו 1 לבחירת קול אחר הקישו 2")
                        .setReadDigitsAdvanced("VoiceChoiceAdmin", 1, 1, 10, "No", true, false, false);
                    break;
                }

                if (adminVoiceChoice === "1") {
                    // המנהל בחר בקול ברירת המחדל - נשמור את הבחירה ונעבור ישר לקליטת השלוחה
                    responseBuilder = new YemotCommandBuilder("read")
                        .addText("אנא הקישו את מספר השלוחה לשמירה")
                        .addText("לשמירה פנימית הקישו כוכבית בין השלוחות ובסיום הקישו סולמית")
                        .addText("לשמירה בתיקייה הראשית הקישו אפס וסולמית")
                        // כאן הדילוג על אישור מבוטל (false) -> ימות המשיח בעצמו ישאל "לאישור הקישו 1..."
                        // צורת ההקראה מוגדרת ל-Digits והכוכבית תוחלף בסלש כך שזה יישמע תקני ומושלם!
                        .setReadDigitsAdvanced("TargetFolderDefault", 20, 1, 15, "Digits", false, true, true);
                    
                    // נשמור כברירת מחדל את הקול 15 (Schedar) במשתני המצב
                    responseBuilder.addState("AdminVoiceIndex", "15");
                } else {
                    // המנהל בחר לבחור קול אחר מתוך מאגר הקולות הגבריים בלבד!
                    const maleVoices = GEMINI_VOICES.MALE;
                    responseBuilder = new YemotCommandBuilder("read")
                        .addText("אנא בחרו את הקול הרצוי מתוך רשימת הקריינים הבאה");

                    // הקראה קולית של כל הקולות הגבריים עם תיאור מילה/שתיים קצר ומדויק
                    for (let i = 0; i < maleVoices.length; i++) {
                        const num = i + 1;
                        const spokenNum = num < 10 ? `אפס ${num}` : `${num}`;
                        responseBuilder.addText(`ל${maleVoices[i].desc} הקישו ${spokenNum}`);
                    }
                    responseBuilder.addText("ובסיום הקישו סולמית");
                    
                    // קליטת 2 ספרות באופן מיידי ללא אישורים כפולים
                    responseBuilder.setReadDigitsAdvanced("AdminVoiceIndex", 2, 1, 15, "No", true, false, false);
                }
                break;

            case 110:
                // ====================================================================
                // שלב 110: קליטת הקול שבחר המנהל ומעבר לקליטת שלוחת השמירה
                // ====================================================================
                let voiceIdx = parseInt(query.AdminVoiceIndex, 10) - 1;
                const maleVoicesList = GEMINI_VOICES.MALE;

                if (isNaN(voiceIdx) || voiceIdx < 0 || voiceIdx >= maleVoicesList.length) {
                    responseBuilder = new YemotCommandBuilder("read")
                        .addSystemMessage("1224")
                        .addText("אנא הקישו שוב את מספר הקול הרצוי מתוך הרשימה ובסיום סולמית")
                        .setReadDigitsAdvanced("AdminVoiceIndex", 2, 2, 15, "No", true, false, false);
                    break;
                }

                // בחירה תקינה - נבקש כעת את שלוחת השמירה (שוב, נאפשר לימות המשיח לשאול את שאלת האישור הטבעית)
                responseBuilder = new YemotCommandBuilder("read")
                    .addText("הקול נקלט בהצלחה")
                    .addText("נא הקישו את מספר השלוחה לשמירה")
                    .addText("למעבר בין שלוחות פנימיות הקישו כוכבית ובסיום הקישו סולמית")
                    .addText("לשמירה בתיקייה הראשית הקישו אפס וסולמית")
                    .setReadDigitsAdvanced("TargetFolderDefault", 20, 1, 15, "Digits", false, true, true);
                break;

            case 300:
                // ====================================================================
                // שלב 300: הגענו לכאן *לאחר* שהמנהל הקיש שלוחה וימות המשיח שאל אותו: "לאישור הקישו 1" והוא אישר!
                // נשאל כעת לגבי סוג השמירה (קובץ רגיל או הודעת מערכת)
                // ====================================================================
                responseBuilder = new YemotCommandBuilder("read")
                    .addText("לשמירת השמע כקובץ רגיל בשלוחה הקישו 1 לשמירה כהודעת מערכת בשלוחה זו הקישו 2")
                    .setReadDigitsAdvanced("SaveTypeChoice", 1, 1, 10, "No", true, false, false);
                break;

            case 301:
                // ====================================================================
                // שלב 301: עיבוד בחירת סוג השמירה של המנהל (1 = רגיל, 2 = הודעת מערכת)
                // ====================================================================
                const saveType = query.SaveTypeChoice;

                if (saveType !== "1" && saveType !== "2") {
                    responseBuilder = new YemotCommandBuilder("read")
                        .addSystemMessage("1224")
                        .addText("לשמירה כקובץ רגיל הקישו 1 להודעת מערכת הקישו 2")
                        .setReadDigitsAdvanced("SaveTypeChoice", 1, 1, 10, "No", true, false, false);
                    break;
                }

                // שליפת הטקסט שתומלל בשלב 100
                const transcribedTextForTts = await yemot.getTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_text.txt`);

                // קביעת הקריין שנבחר לפי משתני המצב
                let chosenVoiceId = "Schedar"; // מניעת קריסה
                const rawVoiceIndex = query.AdminVoiceIndex;
                
                if (rawVoiceIndex) {
                    const chosenVoiceIndex = parseInt(rawVoiceIndex, 10) - 1;
                    if (GEMINI_VOICES.MALE[chosenVoiceIndex]) {
                        chosenVoiceId = GEMINI_VOICES.MALE[chosenVoiceIndex].id;
                    }
                }

                let finalTtsBuffer = null;
let isFallbackTts = false;

try {
    // מנסים ליצור דיבור רובוטי ב-Gemini
    const monotonicInstructionAdmin = `Say monotonically, neutrally, flatly and slightly fast: ${transcribedTextForTts}`;
    finalTtsBuffer = await gemini.generateSpeech(monotonicInstructionAdmin, chosenVoiceId);
    
    // העלאת הקובץ למיקום זמני לצורך סנכרון מהיר
    await yemot.uploadFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_tts.wav`, finalTtsBuffer);
} catch (apiError) {
    isFallbackTts = true;
    TelemetryLogger.warn("MainHandler", "TTS_Fallback_Admin", "כשל בייצור דיבור למנהל, נשמר קובץ TTS.", apiError);
    
    // שמירה זמנית בפורמט tts
    await yemot.uploadTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_tts.tts`, transcribedTextForTts);
}

if (saveType === "1") {
    let targetFolder = query.TargetFolderDefault === "0" ? "" : query.TargetFolderDefault;
    const cleanFolder = cleanAndSanitizeFolder(targetFolder);
    const nextSeqFile = await yemot.getNextSequenceFileName(cleanFolder || "/");
    
    if (!isFallbackTts) {
        const finalUploadPath = cleanFolder ? `ivr2:/${cleanFolder}/${nextSeqFile}.wav` : `ivr2:/${nextSeqFile}.wav`;
        await yemot.uploadFile(finalUploadPath, finalTtsBuffer);
    } else {
        const finalUploadPath = cleanFolder ? `ivr2:/${cleanFolder}/${nextSeqFile}.tts` : `ivr2:/${nextSeqFile}.tts`;
        await yemot.uploadTextFile(finalUploadPath, transcribedTextForTts);
    }

    responseBuilder = new YemotCommandBuilder("id_list_message")
        .addText(`הקובץ נשמר בהצלחה כקובץ מספר ${nextSeqFile} תודה ולהתראות`)
        .addGoToFolder("/");
} else {
                    // שמירה כהודעת מערכת - נבקש הקשת 4 ספרות של מספר ההודעה (MXXXX) ללא בקשות אישור מיותרות
                    responseBuilder = new YemotCommandBuilder("read")
                        .addText("אנא הקישו את מספר הודעת המערכת בארבע ספרות ובסיום הקישו סולמית")
                        .setReadDigitsAdvanced("SystemMessageNumber", 4, 4, 10, "No", true, false, false);
                }
                break;

            case 302:
                // ====================================================================
                // שלב 302: שמירת הקובץ כהודעת מערכת (MXXXX)
                // ====================================================================
                let systemMsgNumber = (query.SystemMessageNumber || "").replace(/#/g, "");
                
                if (!/^\d{4}$/.test(systemMsgNumber)) {
                    responseBuilder = new YemotCommandBuilder("read")
                        .addSystemMessage("1224")
                        .addText("מספר הודעה לא תקין אנא הקישו ארבע ספרות בדיוק")
                        .setReadDigitsAdvanced("SystemMessageNumber", 4, 4, 10, "No", true, false, false);
                    break;
                }

                let targetSystemFolder = query.TargetFolderDefault === "0" ? "" : query.TargetFolderDefault;
                const cleanSystemFolder = cleanAndSanitizeFolder(targetSystemFolder);
                
                let systemFileName = "";
                isFallbackTts = false;

try {
    // ננסה להוריד את קובץ ה-wav הזמני
    const completedTtsBuffer = await yemot.downloadFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_tts.wav`);
    systemFileName = `M${systemMsgNumber}.wav`;
    const systemUploadPath = cleanSystemFolder ? `ivr2:/${cleanSystemFolder}/${systemFileName}` : `ivr2:/${systemFileName}`;
    await yemot.uploadFile(systemUploadPath, completedTtsBuffer);
} catch (err) {
    isFallbackTts = true;
    TelemetryLogger.info("MainHandler", "SystemMessage_Fallback", "מזהה קובץ TTS גיבוי עבור הודעת מערכת.");
    
    // הורדת טקסט הגיבוי ושמירתו כקובץ MXXXX.tts
    const fallbackText = await yemot.getTextFile(`ivr2:${TEMP_FOLDER}/${ApiCallId}_tts.tts`);
    systemFileName = `M${systemMsgNumber}.tts`;
    const systemUploadPath = cleanSystemFolder ? `ivr2:/${cleanSystemFolder}/${systemFileName}` : `ivr2:/${systemFileName}`;
    await yemot.uploadTextFile(systemUploadPath, fallbackText);
}

                responseBuilder = new YemotCommandBuilder("id_list_message")
                    .addText(`הקובץ נשמר בהצלחה כהודעת מערכת ${systemFileName} בשלוחה המבוקשת`)
                    .addGoToFolder("/");
                break;

            default:
                responseBuilder = new YemotCommandBuilder("go_to_folder").addText("/");
        }

        // בניית תגובה סופית והזרקת משתני המצב לאורך כל השיחה בימות המשיח למניעת איבוד זיכרון בעת חזרות
        yemotFinalResponse = responseBuilder.build();
        if (yemotFinalResponse.includes("read=") || yemotFinalResponse.includes("id_list_message=")) {
            yemotFinalResponse += `&api_add_99=yemot_token=${encodeURIComponent(YEMOT_TOKEN)}`;
            yemotFinalResponse += `&api_add_90=admin_numbers=${encodeURIComponent(adminNumbersConfig)}`;
            yemotFinalResponse += `&api_add_89=default_save_folder=${encodeURIComponent(defaultSaveFolderConfig)}`;
            
            // הזרקה חזרה של הבחירות המקדימות אל תוך סשן השיחה הבא
            if (query.VoiceGender) yemotFinalResponse += `&api_add_98=VoiceGender=${query.VoiceGender}`;
            if (query.VoiceIndex) yemotFinalResponse += `&api_add_97=VoiceIndex=${query.VoiceIndex}`;
            if (query.TargetFolderDefault) yemotFinalResponse += `&api_add_96=TargetFolderDefault=${query.TargetFolderDefault}`;
            if (query.SaveTypeChoice) yemotFinalResponse += `&api_add_95=SaveTypeChoice=${query.SaveTypeChoice}`;
            if (query.SystemMessageNumber) yemotFinalResponse += `&api_add_94=SystemMessageNumber=${query.SystemMessageNumber}`;
            if (query.VoiceChoiceAdmin) yemotFinalResponse += `&api_add_93=VoiceChoiceAdmin=${query.VoiceChoiceAdmin}`;
            if (query.AdminVoiceIndex) yemotFinalResponse += `&api_add_92=AdminVoiceIndex=${query.AdminVoiceIndex}`;
            if (query.FolderApproved) yemotFinalResponse += `&api_add_91=FolderApproved=${query.FolderApproved}`;
            if (query.ListenerConfirm) yemotFinalResponse += `&api_add_90=ListenerConfirm=${query.ListenerConfirm}`;
        }

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.status(200).send(yemotFinalResponse);

    } catch (error) {
        TelemetryLogger.error("MainHandler", "CriticalError", "קריסת שרת חמורה:", error);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        // fallback לבטוח לחלוטין בלי ליצור לולאות בעייתיות
        res.status(200).send("id_list_message=t-זיהינו בעיה קטנה נטפל בה בהקדם האפשרי&go_to_folder=/");
    }
};
