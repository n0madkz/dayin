const DISH_CATEGORIES=['Салаты','Закуски','Супы','Горячие блюда','Паста','Фастфуд','Пицца','Суши и роллы','Десерты','Напитки','Другое'];
function dishCategory(d){if(DISH_CATEGORIES.includes(d.category))return d.category;const legacy={'Салат с burrata':'Салаты','Паста с грибами':'Паста','Лосось на гриле':'Горячие блюда','Тирамису':'Десерты'};return legacy[d.name]||'Другое'}
module.exports={DISH_CATEGORIES,dishCategory};
