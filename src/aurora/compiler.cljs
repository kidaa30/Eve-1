(ns aurora.compiler
  (:require [clojure.walk :refer [postwalk-replace]]
            [aurora.jsth :as jsth]
            [aurora.datalog :as datalog]
            [aurora.schema :as schema]
            [aurora.code :as code]
            aurora.util)
  (:require-macros [aurora.macros :refer [for! check deftraced]]
                   [aurora.datalog :refer [rule q1 q* q?]]))

;; ids

(let [next (atom 0)]
  (defn new-id []
    (if js/window.uuid
      (.replace (js/uuid) (js/RegExp. "-" "gi") "_")
      (swap! next inc))))

(deftraced id->value [id] [id]
  (check id)
  (symbol (str "value_" (name id))))

;; compiler

(defn jsth? [value]
  true ;; TODO not very helpful
  )

(defn chain [& forms]
  (reduce
   (fn [tail form]
     (clojure.walk/postwalk-replace {::tail tail} form))
   (reverse forms)))

(def schemas
  [(schema/has-one :jsth/step (schema/is! jsth?))
   (schema/has-one :jsth/pattern (schema/is! jsth?))])

(def data-rules
  [(rule [?e :data/nil _]
         :return
         [e :jsth/step nil])
   (rule [?e :data/number ?number]
         :return
         [e :jsth/step number])
   (rule [?e :data/text ?text]
         :return
         [e :jsth/step text])
   (rule [?e :data/vector ?elems]
         :return
         [e :jsth/step `(cljs.core.PersistentVector.fromArray
                       ~(vec (map id->value elems)))])
   (rule [?e :data/map ?keys&vals]
         :return
         [e :jsth/step `(cljs.core.PersistentHashMap.fromArrays
                       ~(vec (map id->value (keys keys&vals)))
                       ~(vec (map id->value (vals keys&vals))))])])

(def call-rules
  [(rule [?e :call/fun ?fun]
         [?e :call/args ?args]
         :return
         [e :jsth/step `(~(id->value fun) ~@(map id->value args))])])

(def match-rules
  ;; NOTE lack of subqueries hurts here
  [[(rule [?e :pattern/any _]
          :return
          [e :jsth/pattern ::tail])
    (rule [?e :data/number ?number]
          :return
          [e :jsth/pattern `(if (= ::arg ~number) ::tail)])
    (rule [?e :data/text ?text]
          :return
          [e :jsth/pattern `(if (= ::arg ~text) ::tail)])]
   [(fn [kn]
      (q* kn
          [?e :pattern/vector ?elems]
          (every? #(seq (datalog/has kn % :jsth/pattern)) elems) ;; hack to prevent q1 blowing up
          :return
          (let [jsth-elems (for [i (range (count elems))]
                             (let [elem (nth elems i)]
                               (q1 kn
                                   [elem :jsth/pattern ?jsth-elem]
                                   :return
                                   `(do
                                      (let! ~(id->value elem) (cljs.core.nth ::arg ~i))
                                      ~(postwalk-replace {::arg (id->value elem)} jsth-elem)))))]
            [e :jsth/pattern `(if (cljs.core.vector_QMARK_ ::arg)
                                (if (= ~(count elems) (cljs.core.count ::arg))
                                  ~(apply chain jsth-elems)))])))
    (fn [kn]
      (q* kn
          [?e :pattern/map ?keys&vals]
          (every? #(seq (datalog/has kn % :jsth/step)) (keys keys&vals)) ;; hack to prevent q1 blowing up
          (every? #(seq (datalog/has kn % :jsth/pattern)) (vals keys&vals)) ;; hack to prevent q1 blowing up
          :return
          (let [jsth-vals (for [key (keys keys&vals)]
                            (let [val (get keys&vals key)]
                              (q1 kn
                                  [key :jsth/step ?jsth-key]
                                  [val :jsth/pattern ?jsth-val]
                                  :return
                                  `(do
                                     (let! ~(id->value key) ~jsth-key)
                                     (if (cljs.core.contains_QMARK_ ::arg ~(id->value key))
                                       (do
                                         (let! ~(id->value val) (cljs.core.get ::arg ~(id->value key)))
                                         ~(postwalk-replace {::arg (id->value val)} jsth-val)))))))]
            [e :jsth/pattern `(if (cljs.core.map_QMARK_ ::arg)
                                ~(apply chain jsth-vals))])))]
   [(fn [kn]
      (q* kn
          [?e :branch/guards ?guards]
          (every? #(seq (datalog/has kn % :jsth/step)) guards) ;; hack to prevent q1 blowing up
          :return
          (let [jsth-guards (for [guard guards]
                              (q1 kn
                                  [guard :jsth/step ?jsth-guard]
                                  :return
                                  `(if ~jsth-guard ::tail)))]
            [e :jsth/guards (apply chain (concat jsth-guards [::tail]))])))]
   [(rule [?e :branch/pattern ?pattern]
          [?pattern :jsth/pattern ?jsth-pattern]
          [?e :branch/guards ?guards]
          [?e :jsth/guards ?jsth-guards] ;; cant attach directly to guards :(
          [?e :branch/action ?action]
          [?action :jsth/step ?jsth-action]
          :return
          [e :jsth/branch `(do
                             ~(chain jsth-pattern jsth-guards `(return ~jsth-action))
                             ::tail)])]
    [(fn [kn]
      (q* kn
          [?e :match/arg ?arg]
          [?e :match/branches ?branches]
          (every? #(seq (datalog/has kn % :jsth/branch)) branches) ;; hack to prevent q1 blowing up
          :return
          (let [jsth-branches (for [branch branches]
                                (q1 kn
                                    [branch :jsth/branch ?jsth-branch]
                                    :return
                                    jsth-branch))]
            [e :jsth/step `((fn [~(id->value arg)]
                              ~(postwalk-replace {::arg (id->value arg)} (apply chain (concat jsth-branches [`(throw "failed")]))))
                            ~(id->value arg))])))]])

(def page-rules
  [(fn [kn]
     (q* kn
         [?e :page/args ?args]
         [?e :page/steps ?steps]
         (every? #(seq (datalog/has kn % :jsth/step)) steps) ;; hack to prevent q1 blowing up
         :return
         (let [jsth-steps (for [step steps]
                            (q1 kn
                                [step :jsth/step ?jsth-step]
                                :return
                                `(let! ~(id->value step) ~jsth-step)))]
           [e :jsth/page `(fn ~(id->value e) [~@(map id->value args)]
                            (do ~@jsth-steps
                              (return ~(id->value (last steps)))))])))])

(def rules
  `[~data-rules
    ~call-rules
    ~@match-rules
    ~page-rules])

(defn one-rule [kn]
  (let [primitives (q* kn
                       [?e :js/name ?name]
                       :return
                       `(do
                          (let! ~(id->value e) ~(symbol name))
                          (set! (.. program ~(id->value e)) ~(id->value e))))
        steps (q* kn
                  [?e :jsth/page ?jsth-page]
                  :return
                  `(do
                     ~jsth-page
                     (set! (.. program ~(id->value e)) ~(id->value e))))]
    `((fn []
        (do
          (let! program {})
          ~@primitives
          ~@steps
          (return program))))))

(defn compile [facts]
  (one-rule (datalog/knowledge facts (concat code/rules rules))))

(-> (clojure.set/union code/stdlib code/example-a)
    (datalog/knowledge (concat code/rules rules))
    one-rule
    (jsth/expression->string)
    #_js/console.log
    js/eval
    (.value_root 1 2 3))

(-> (clojure.set/union code/stdlib code/example-b)
    (datalog/knowledge (concat code/rules rules))
    one-rule
    (jsth/expression->string)
    #_js/console.log
    js/eval
    (.value_root {"a" 1 "b" 2}))

(-> (clojure.set/union code/stdlib code/example-b)
    (datalog/knowledge (concat code/rules rules))
    one-rule
    (jsth/expression->string)
    #_js/console.log
    js/eval
    (.value_root {"a" 1 "c" 2}))
