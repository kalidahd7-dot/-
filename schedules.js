module.exports = {
  schedules: {
    men: {
      days: ["الثلاثاء", "الأربعاء", "الخميس"],
      periods: [
        { id: "morning", label: "صباحية", time: "9:00 - 11:00" },
        { id: "afternoon", label: "مسائية", time: "2:00 - 3:30" },
        { id: "night", label: "ليلية", time: "9:00 - 11:00" }
      ]
    },
    women: {
      days: ["السبت", "الأحد", "الاثنين"],
      periods: [
        { id: "morning", label: "صباحية", time: "9:00 - 11:00" },
        { id: "afternoon", label: "مسائية", time: "2:00 - 3:30" },
        { id: "night", label: "ليلية", time: "9:00 - 11:00" }
      ]
    }
  },

  books: [
    { id: "norania", title: "📘 القاعدة النورانية", url: "https://archive.org/download/NooraniQaida/NooraniQaida.pdf" },
    { id: "jazariya", title: "📗 متن الجزرية", url: "https://ia801507.us.archive.org/13/items/waq74534/74534.pdf" },
    { id: "tuhfa", title: "📙 تحفة الأطفال", url: "https://archive.org/download/TuhfatAlAtfal/TuhfatAlAtfal.pdf" },
    { id: "shatibiya", title: "📕 متن الشاطبية", url: "https://archive.org/download/shatibiya/shatibiya.pdf" },
    { id: "aqila", title: "📔 عقيلة أتراب القصائد", url: "https://archive.org/download/aqila/aqila.pdf" },
    { id: "tayyiba", title: "📓 طيبة النشر", url: "https://archive.org/download/tayyiba/tayyiba.pdf" }
  ],

  matnExplanations: {
    jazariya: {
      title: "شرح متن الجزرية",
      playlist: "https://www.youtube.com/playlist?list=PLdkqnk87UnGHqeLXqpF1hlNX08sIi-Mag",
      count: 11
    },
    tuhfa: {
      title: "شرح تحفة الأطفال",
      playlist: "https://www.youtube.com/playlist?list=PLdkqnk87UnGH2KTeOIO3REuc-esITW0Zh",
      count: 18
    },
    shatibiya: {
      title: "شرح الشاطبية - د. الصادق الخازمي",
      playlist: "https://www.youtube.com/playlist?list=PL2bhncdDbT9WjTlkFfB7VBbBFxI4nQtF_",
      count: 39
    },
    norania: {
      title: "دروس القاعدة النورانية",
      playlist: "https://www.youtube.com/playlist?list=PLDGSJOlM3XL8j2l6Qzm9qe4CJID1-GVCE",
      count: 14
    }
  },

  lectures: [
    { id: "lec1", title: "🎓 كيف تقرأ القرآن الكريم - مقدمة", url: "https://www.youtube.com/watch?v=lChx9LzuQY8" },
    { id: "lec2", title: "📖 أخطاء شائعة في التلاوة", url: "https://www.youtube.com/watch?v=Ob68NpPRnag" },
    { id: "lec3", title: "🔊 أحكام النون الساكنة والتنوين", url: "https://www.youtube.com/watch?v=lA9-8Gt5TQY" },
    { id: "lec4", title: "📚 أحكام المدود", url: "https://www.youtube.com/watch?v=Qx5KkFW4P7g" },
    { id: "lec5", title: "🎯 مخارج الحروف", url: "https://www.youtube.com/watch?v=KJz9y0uBOTw" },
    { id: "lec6", title: "🕌 أحكام الميم الساكنة", url: "https://www.youtube.com/watch?v=wNvBEPNL3Ao" },
    { id: "lec7", title: "📕 الوقف والابتداء", url: "https://www.youtube.com/watch?v=JzK7jCVJXKo" },
    { id: "lec8", title: "🔔 التفخيم والترقيق", url: "https://www.youtube.com/watch?v=PqB1eIY9WzM" },
    { id: "lec9", title: "📖 سلسلة تصحيح التلاوة (كاملة)", url: "https://www.youtube.com/playlist?list=PLJi21Zen45zQkaBMvAB-p0fHYN4iAbOH8" },
    { id: "lec10", title: "🎧 قناة الشيخ الرسمية", url: "https://www.youtube.com/@DrAymanSowaid/playlists" }
  ],

  salafiScholars: [
    {
      id: "badr",
      name: "الشيخ عبد الرزاق البدر",
      channel: "https://www.youtube.com/c/sheikhalbadr",
      description: "دروس ومحاضرات في العلوم الشرعية"
    },
    {
      id: "shuwayer",
      name: "الشيخ عبد السلام الشويعر",
      channel: "https://www.youtube.com/@alshuwayer9",
      description: "شروح الفقه والعقيدة والمحاضرات"
    },
    {
      id: "usaimi",
      name: "الشيخ صالح العصيمي",
      channel: "https://www.youtube.com/channel/UCdFHxmDMO8gKRJ4gVRU7XLA",
      description: "الدروس الكاملة + تعليقات على كتب التجويد",
      extra: {
        title: "فوائد الفوائد",
        url: "https://www.youtube.com/@fawaedalfawaed"
      }
    },
    {
      id: "ruhaily",
      name: "الشيخ سليمان الرحيلي",
      channel: "https://youtube.com/@Asalafea121",
      description: "الدروس العلمية والمحاضرات"
    }
  ]
};